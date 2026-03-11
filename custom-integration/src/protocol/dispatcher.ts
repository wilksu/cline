import { Logger } from "../utils/logger";
import { ToolExecutor } from "../protocol/executor";

export async function dispatchCommand(inputText: string): Promise<string> {
    try {
        Logger.info(`[Dispatcher] Processing input: ${inputText.substring(0, 100)}...`);
        // 委托给 Executor 处理，保持分发器逻辑简单
        return await ToolExecutor.execute(inputText);
    } catch (err) {
        Logger.error("[Dispatcher] Error:", err);
        throw err;
    }
}
