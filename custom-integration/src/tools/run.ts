import { execa } from "execa";
import { BaseTool } from "./base";
import { Logger } from "../utils/logger";

export class RunTool extends BaseTool {
    async execute(args: string[]): Promise<string> {
        const command = args.join(" ");
        if (!command) return "Error: No command provided";

        Logger.info(`[Run] Executing: ${command}`);

        try {
            // 使用 shell: true 保证能执行别名和环境变量扩展
            const child = execa(command, {
                shell: true,
                cwd: this.workspaceRoot,
                all: true, // 捕获 stdout 和 stderr
                timeout: 30000 // 默认 30s 超时保护
            });

            // 实时打印输出到 OutputChannel
            child.all?.on("data", (chunk) => {
                Logger.debug(`[Run Output] ${chunk.toString().trim()}`);
            });

            const { all } = await child;
            return all || "[Command completed with no output]";
        } catch (err: any) {
            Logger.error("Command failed", err);
            return `Execution failed: ${err.all || err.message}`;
        }
    }
}
