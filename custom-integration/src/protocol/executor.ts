import { HostProvider } from "@hosts/host-provider";
import { parseInput } from "./parser";
import { LSTool } from "../tools/ls";
import { ReadTool } from "../tools/read";
import { SearchTool } from "../tools/search";
import { RunTool } from "../tools/run";
import { FileAdapter } from "../adapters/file-adapter";

export class ToolExecutor {
    static async execute(inputText: string): Promise<string> {
        const response = await HostProvider.workspace.getWorkspacePaths({});
        if (!response.paths?.length) return "Error: No workspace open";
        
        const root = response.paths[0];
        const commands = parseInput(inputText);
        const results: string[] = [];

        for (const cmd of commands) {
            try {
                let output = "";
                const adapter = new FileAdapter(root);
                
                if (cmd.type === 'action' && cmd.actionPayload) {
                    const p = cmd.actionPayload;
                    output = p.isEdit 
                        ? await adapter.applyEdit(p.path, p.content, p.expectedHash)
                        : await adapter.writeFile(p.path, p.content, p.expectedHash);
                } else {
                    switch (cmd.name) {
                        case "ls": output = await new LSTool(root).execute(cmd.args); break;
                        case "read": output = await new ReadTool(root).execute(cmd.args); break;
                        case "search": output = await new SearchTool(root).execute(cmd.args); break;
                        case "run": output = await new RunTool(root).execute(cmd.args); break;
                        default: output = `Unknown tool: ${cmd.name}`;
                    }
                }
                results.push(`[OK] ${cmd.name}\n${output}`);
            } catch (err: any) {
                results.push(`[FAIL] ${cmd.name}\n${err.message}`);
            }
        }
        return results.join("\n\n");
    }
}
