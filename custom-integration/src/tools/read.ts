import * as path from "path";
import * as fs from "fs/promises";
import { BaseTool } from "./base";

export class ReadTool extends BaseTool {
    async execute(args: string[]): Promise<string> {
        if (args.length === 0) return "Error: No file specified";
        
        const results = await Promise.all(args.map(async (fPath) => {
            const absolutePath = path.join(this.workspaceRoot, fPath);
            try {
                const text = await fs.readFile(absolutePath, 'utf8');
                
                const stat = await fs.stat(absolutePath);
                const hash = (Math.floor(stat.mtime.getTime()).toString(36) + stat.size.toString(36)).toUpperCase();
                
                return `--- ${fPath}[${hash}] ---\n${text}\n`;
            } catch {
                return `Error: Could not read ${fPath}`;
            }
        }));

        return results.join("\n");
    }
}
