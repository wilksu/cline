/**
 * Ws-Bridge 重构后的入口文件
 * 负责生命周期管理，不再直接耦合在 extension.ts 的 activate 中
 */
import * as vscode from "vscode";
import { WsBridgeServer } from "./protocol/server";
import { Logger } from "./utils/logger";

export const WsBridge = {
    async bootstrap(context: vscode.ExtensionContext) {
        Logger.info("Ws-Bridge bootstrap sequence started...");
        
        // 注册控制命令，方便用户手动开关
        context.subscriptions.push(
            // biome-ignore lint/nursery/noRestrictedImports: Command registration is required
            vscode.commands.registerCommand("cline.wsBridge.start", () => WsBridgeServer.start()),
            // biome-ignore lint/nursery/noRestrictedImports: Command registration is required
            vscode.commands.registerCommand("cline.wsBridge.stop", () => WsBridgeServer.stop())
        );

        // 根据配置自动启动
        const config = vscode.workspace.getConfiguration("cline.wsBridge");
        if (config.get<boolean>("autoStart", false)) {
            await WsBridgeServer.start();
        }

        // 确保销毁时关闭服务器
        context.subscriptions.push({
            dispose: () => WsBridgeServer.stop()
        });
    }
};

// 导出 bootstrap 函数供 CI 注入调用
export const bootstrap = WsBridge.bootstrap;
