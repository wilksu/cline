import { WebSocketServer } from "ws";
import { HostProvider } from "../../../src/hosts/host-provider";
import { Logger } from "../utils/logger";
import { dispatchCommand } from "./dispatcher";

let wss: WebSocketServer | null = null;

export const WsBridgeServer = {
    async start() {
        if (wss) return;
        
        // 注意：HostProvider 不直接暴露 getConfiguration，通常通过 state 或 env 注入
        // 这里的补丁为了保持功能，尝试从系统环境变量或默认值获取
        const port = Number(process.env.CLINE_WS_PORT) || 3456;
        
        try {
            wss = new WebSocketServer({ port });
        } catch (err: any) {
            if (HostProvider.isInitialized()) {
                HostProvider.window.showMessage({ 
                    message: `Failed to start Ws-Bridge: Port ${port} is already in use.`,
                    type: 1 // Error
                });
            }
            return;
        }

        wss.on("connection", (ws) => {
            Logger.info("Browser client connected via WebSocket");
            
            ws.on("message", async (data) => {
                try {
                    const result = await dispatchCommand(data.toString());
                    ws.send(result);
                } catch (err) {
                    ws.send(JSON.stringify({ status: "error", message: String(err) }));
                }
            });
        });

        if (HostProvider.isInitialized()) {
            HostProvider.window.showMessage({
                message: `Cline Ws-Bridge started on port ${port}`,
                type: 3 // Info
            });
        }
    },

    stop() {
        if (wss) {
            wss.close();
            wss = null;
            Logger.info("Ws-Bridge server stopped.");
        }
    }
};
