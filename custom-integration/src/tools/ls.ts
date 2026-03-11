import * as vscode from "vscode";
import * as path from "path";
import { BaseTool } from "./base";

export class LSTool extends BaseTool {
    async execute(args: string[]): Promise<string> {
        const relativePath = args[0] || ".";
        const targetUri = vscode.Uri.file(path.join(this.workspaceRoot, relativePath));

        try {
            const entries = await vscode.workspace.fs.readDirectory(targetUri);
            const output = entries
                .map(([name, type]) => {
                    const isDir = type === vscode.FileType.Directory;
                    return `${isDir ? '[DIR] ' : '      '}${name}`;
                })
                .join("\n");
            
            return output || "(Empty directory)";
        } catch (err) {
            return `Error listing directory: ${relativePath}`;
        }
    }
}
