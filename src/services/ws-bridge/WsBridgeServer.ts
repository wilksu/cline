/**
 * WsBridgeServer - WebSocket server for browser automation
 * Migrated from ws-agent/webSocketServer.ts
 */

import { WebSocket, WebSocketServer } from "ws"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/host/window"
import { disposeIgnoreControllers } from "./ignore"
import { Logger } from "./Logger"
import { executeCommands } from "./ToolExecutor"

let wss: WebSocketServer | null = null

/**
 * Start the WebSocket server
 */
export function startServer(port: number = 3456): void {
	if (wss) {
		Logger.info("WebSocket server is already running.")
		HostProvider.window.showMessage({
			message: `Cline WsBridge is already listening on port: ${port}`,
			type: ShowMessageType.INFORMATION,
		})
		return
	}

	wss = new WebSocketServer({ port })

	wss.on("listening", () => {
		Logger.info(`WebSocket server listening on: ws://localhost:${port}`)
		HostProvider.window.showMessage({
			message: `Cline WsBridge listening on port: ${port}`,
			type: ShowMessageType.INFORMATION,
		})
	})

	wss.on("connection", (ws: WebSocket) => {
		Logger.info("WebSocket client connected")

		ws.on("message", async (messageBuffer: Buffer) => {
			const inputText = messageBuffer.toString("utf-8")
			Logger.info(`WS message received: ${inputText.substring(0, 50)}...`)

			try {
				const response = await executeCommands(inputText)
				ws.send(response)
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				Logger.error(`Error handling WS message`, error)
				ws.send(JSON.stringify({ status: "error", message: errorMessage }))
			}
		})

		ws.on("close", () => {
			Logger.info("WebSocket client disconnected")
		})

		ws.on("error", (error: Error) => {
			Logger.error("WebSocket connection error", error)
		})
	})

	wss.on("error", (error: Error) => {
		Logger.error("WebSocket server failed to start", error)
		HostProvider.window.showMessage({
			message: `Cline WsBridge failed to start: ${error.message}`,
			type: ShowMessageType.ERROR,
		})
		wss = null
	})
}

/**
 * Stop the WebSocket server
 */
export function stopServer(): void {
	if (wss) {
		// Clean up file watchers to prevent memory leaks
		disposeIgnoreControllers().catch((e) => Logger.error("Failed to dispose ignore controllers", e))

		wss.close((err?: Error) => {
			if (err) {
				Logger.error("Error stopping WebSocket server", err)
				HostProvider.window.showMessage({
					message: `Error stopping WsBridge: ${err.message}`,
					type: ShowMessageType.ERROR,
				})
			} else {
				Logger.info("WebSocket server stopped successfully.")
				HostProvider.window.showMessage({ message: "Cline WsBridge stopped.", type: ShowMessageType.INFORMATION })
			}
		})
		wss = null
	} else {
		Logger.info("WebSocket server is not running.")
		HostProvider.window.showMessage({ message: "Cline WsBridge is not running.", type: ShowMessageType.INFORMATION })
	}
}

/**
 * Check if server is running
 */
export function isRunning(): boolean {
	return wss !== null
}

/**
 * Dispose the server (for extension deactivation)
 */
export function dispose(): void {
	if (wss) {
		disposeIgnoreControllers().catch((e) => Logger.error("Failed to dispose ignore controllers", e))
		wss.close()
		wss = null
		Logger.info("WsBridge disposed.")
	}
}
