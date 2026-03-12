import * as vscode from "vscode";
import * as path from "path";

export class FileAdapter {
    constructor(private readonly workspaceRoot: string) {}

    private async getFileHash(uri: vscode.Uri): Promise<string> {
        try {
            // biome-ignore lint: Native VSCode FS is required for ws-bridge logic
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

        \n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
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

        if (searchEditsApplied === 0) {
            throw new Error("No valid SEARCH/REPLACE blocks found.");
        }

        // biome-ignore lint: Native VSCode FS is required for ws-bridge logic
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
        // biome-ignore lint: Native VSCode FS is required for ws-bridge logic
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        const newHash = await this.getFileHash(uri);
        return `[SUCCESS] Written ${relativePath}\nNew Hash Reference: ${relativePath}[${newHash}]`;
    }
}
