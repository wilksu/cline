import * as vscode from "vscode";
import * as path from "path";

export class FileAdapter {
    constructor(private readonly workspaceRoot: string) {}

    private async getFileHash(uri: vscode.Uri): Promise<string> {
        try {
            // biome-ignore all: Native VSCode FS is required for ws-bridge logic
            const stat = await vscode.workspace.fs.stat(uri);
            return (Math.floor(stat.mtime).toString(36) + stat.size.toString(36)).toUpperCase();
        } catch { return "NONE"; }
    }

    async applyEdit(relativePath: string, codeBlock: string, expectedHash?: string): Promise<string> {
        const uri = vscode.Uri.file(path.join(this.workspaceRoot, relativePath));
        const currentHash = await this.getFileHash(uri);

        if (expectedHash && expectedHash !== currentHash) {
            throw new Error(`Hash mismatch (Dirty Write)! Expected: [${expectedHash}], Current: [${currentHash}]`);
        }

        // biome-ignore all: Native VSCode FS is required for ws-bridge logic
        const uint8Array = await vscode.workspace.fs.readFile(uri);
        let content = Buffer.from(uint8Array).toString('utf8').replace(/\r\n/g, "\n");

        // 1. 处理 LINES 模式: <<<<<<< LINES: start-end
        const lineBlockRegex = /<<<<<<< LINES:\s*(\d+)-(\d+)\n([\s\S]*?)>>>>>>>/g;
        let lineMatch;
        const lines = content.split("\n");
        let lineEditsApplied = 0;

        while ((lineMatch = lineBlockRegex.exec(codeBlock)) !== null) {
            const start = parseInt(lineMatch[1]) - 1;
            const end = parseInt(lineMatch[2]);
            const newText = lineMatch[3].replace(/\r\n/g, "\n").trimEnd();
            lines.splice(start, end - start, newText);
            lineEditsApplied++;
        }
        if (lineEditsApplied > 0) content = lines.join("\n");

        // 2. 处理 SEARCH/REPLACE 模式
        const blockRegex = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
        let match;
        let searchEditsApplied = 0;

        while ((match = blockRegex.exec(codeBlock)) !== null) {
            const searchPart = match[1].replace(/\r\n/g, "\n");
            const replacePart = match[2].replace(/\r\n/g, "\n");

            if (!content.includes(searchPart)) {
                throw new Error(`SEARCH block not found in ${relativePath}`);
            }
            content = content.replace(searchPart, replacePart);
            searchEditsApplied++;
        }

        if (lineEditsApplied === 0 && searchEditsApplied === 0) {
            throw new Error("No valid edit blocks found.");
        }

        // biome-ignore all: Native VSCode FS is required for ws-bridge logic
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        const newHash = await this.getFileHash(uri);
        return `[SUCCESS] Edited ${relativePath}\nNew Hash Reference: ${relativePath}[${newHash}]`;
    }

    async writeFile(relativePath: string, content: string, expectedHash?: string): Promise<string> {
        const uri = vscode.Uri.file(path.join(this.workspaceRoot, relativePath));
        if (expectedHash) {
            const currentHash = await this.getFileHash(uri);
            if (expectedHash !== currentHash) throw new Error("Hash mismatch!");
        }
        // biome-ignore all: Native VSCode FS is required for ws-bridge logic
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        const newHash = await this.getFileHash(uri);
        return `[SUCCESS] Written ${relativePath}\nNew Hash Reference: ${relativePath}[${newHash}]`;
    }
}
