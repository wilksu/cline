import { WebSocketServer } from "ws";
import { HostProvider } from "@hosts/host-provider";
import { ShowMessageType } from "@shared/proto/host/window";
import { Logger } from "../utils/logger";
import { dispatchCommand } from "./dispatcher";

let wss: WebSocketServer | null = null;

export const WsBridgeServer = {
    async start() {
        if (wss) return;
        
        const port = Number(process.env.CLINE_WS_PORT) || 3456;
        
        try {
            wss = new WebSocketServer({ port });
        } catch (err: any) {
            if (HostProvider.isInitialized()) {
                HostProvider.window.showMessage({ 
                    message: `Failed to start Ws-Bridge: Port ${port} is already in use.`,
                    type: ShowMessageType.ERROR
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
                type: ShowMessageType.INFORMATION
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
