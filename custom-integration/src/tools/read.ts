import * as vscode from "vscode";
import * as path from "path";
import { BaseTool } from "./base";
import { FileAdapter } from "../adapters/file-adapter";

export class ReadTool extends BaseTool {
    async execute(args: string[]): Promise<string> {
        if (args.length === 0) return "Error: No file specified";
        
        const fileAdapter = new FileAdapter(this.workspaceRoot);
        const results = await Promise.all(args.map(async (fPath) => {
            const uri = vscode.Uri.file(path.join(this.workspaceRoot, fPath));
            try {
                // biome-ignore lint: Native VSCode FS is required
                const content = await vscode.workspace.fs.readFile(uri);
                const text = Buffer.from(content).toString('utf8');
                
                // 这里暂时模拟获取 Hash 的逻辑（稍后在 FileAdapter 增强）
                // biome-ignore lint: Native VSCode FS is required
                const stat = await vscode.workspace.fs.stat(uri);
                const hash = (Math.floor(stat.mtime).toString(36) + stat.size.toString(36)).toUpperCase();
                
                return `--- ${fPath}[${hash}] ---\n${text}\n`;
            } catch {
                return `Error: Could not read ${fPath}`;
            }
        }));

        return results.join("\n");
    }
}
