import * as path from "path";
import * as fs from "fs/promises";
import { writeFile, fileExistsAtPath } from "@utils/fs";

export class FileAdapter {
    constructor(private readonly workspaceRoot: string) {}

    private async getFileHash(absolutePath: string): Promise<string> {
        try {
            const stat = await fs.stat(absolutePath);
            return (Math.floor(stat.mtime.getTime()).toString(36) + stat.size.toString(36)).toUpperCase();
        } catch { return "NONE"; }
    }

    async applyEdit(relativePath: string, codeBlock: string, expectedHash?: string): Promise<string> {
        const absolutePath = path.join(this.workspaceRoot, relativePath);
        const currentHash = await this.getFileHash(absolutePath);

        if (expectedHash && expectedHash !== "NONE" && expectedHash !== currentHash) {
            throw new Error(`Hash mismatch (Dirty Write)! Expected: [${expectedHash}], Current: [${currentHash}]`);
        }

        if (!(await fileExistsAtPath(absolutePath))) {
            throw new Error(`File not found: ${relativePath}`);
        }

        let content = await fs.readFile(absolutePath, 'utf8');
        content = content.replace(/\r\n/g, "\n");

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

        if (searchEditsApplied === 0) {
            throw new Error("No valid SEARCH/REPLACE blocks found.");
        }

        await writeFile(absolutePath, content);
        const newHash = await this.getFileHash(absolutePath);
        return `[SUCCESS] Edited ${relativePath}\nNew Hash Reference: ${relativePath}[${newHash}]`;
    }

    async writeFile(relativePath: string, content: string, expectedHash?: string): Promise<string> {
        const absolutePath = path.join(this.workspaceRoot, relativePath);
        if (expectedHash && expectedHash !== "NONE") {
            const currentHash = await this.getFileHash(absolutePath);
            if (expectedHash !== currentHash) throw new Error("Hash mismatch!");
        }
        await writeFile(absolutePath, content);
        const newHash = await this.getFileHash(absolutePath);
        return `[SUCCESS] Written ${relativePath}\nNew Hash Reference: ${relativePath}[${newHash}]`;
    }
}
