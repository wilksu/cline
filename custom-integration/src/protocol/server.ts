import { WebSocketServer } from "ws";
import * as vscode from "vscode";
import { Logger } from "../utils/logger";
import { dispatchCommand } from "./dispatcher";

let wss: WebSocketServer | null = null;

export const WsBridgeServer = {
    async start() {
        if (wss) return;
        
        const config = vscode.workspace.getConfiguration("cline.wsBridge");
        const port = config.get<number>("port", 3456);
        
        try {
            wss = new WebSocketServer({ port });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to start Ws-Bridge: Port ${port} is already in use.`);
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

        vscode.window.showInformationMessage(`Cline Ws-Bridge started on port ${port}`);
    },

    stop() {
        if (wss) {
            wss.close();
            wss = null;
            Logger.info("Ws-Bridge server stopped.");
        }
    }
};
