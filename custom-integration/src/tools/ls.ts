import * as path from "path";
import * as fs from "fs/promises";
import { BaseTool } from "./base";

export class LSTool extends BaseTool {
    async execute(args: string[]): Promise<string> {
        const relativePath = args[0] || ".";
        const absolutePath = path.join(this.workspaceRoot, relativePath);

        try {
            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const output = entries
                .map((entry) => {
                    const isDir = entry.isDirectory();
                    return `${isDir ? '[DIR] ' : '      '}${entry.name}`;
                })
                .sort((a, b) => {
                    // 文件夹排在前面
                    if (a.startsWith('[DIR]') && !b.startsWith('[DIR]')) return -1;
                    if (!a.startsWith('[DIR]') && b.startsWith('[DIR]')) return 1;
                    return a.localeCompare(b);
                })
                .join("\n");
            
            return output || "(Empty directory)";
        } catch (err) {
            return `Error listing directory: ${relativePath}`;
        }
    }
}
