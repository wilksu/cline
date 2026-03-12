import { execa } from "execa";
import { BaseTool } from "./base";
import { Logger } from "../utils/logger";
import { HostProvider } from "@hosts/host-provider";

export class SearchTool extends BaseTool {
    async execute(args: string[]): Promise<string> {
        const pattern = args[0];
        const subDir = args[1] || ".";
        
        try {
            const rgPath = await HostProvider.get().getBinaryLocation("rg");
            
            Logger.info(`[Search] Searching for "${pattern}" using ${rgPath}`);
            
            const { stdout } = await execa(rgPath, [
                "--column",
                "--line-number",
                "--no-heading",
                "--color", "never",
                "--smart-case",
                "--max-columns", "512",
                pattern,
                subDir
            ], {
                cwd: this.workspaceRoot,
                reject: false 
            });

            return stdout || "(No matches found)";
        } catch (err) {
            Logger.error("Search failed", err);
            return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
        }
    }
}
