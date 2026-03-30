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
// 使用 Map 维护会话：SessionID -> WebSocket
const sessionMap = new Map<string, WebSocket>()

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
		let currentSessionId: string | null = null

		// 全局通知路由（异步导入 WebviewProvider 以规避循环依赖）
		import("../../core/webview").then((module) => {
			const provider = module.WebviewProvider.getInstance()
			if (provider?.controller?.mcpHub) {
				provider.controller.mcpHub.setNotificationCallback((serverName, level, message) => {
					const payload = JSON.stringify({
						type: "proactive_notification",
						source: `MCP:${serverName}`,
						level,
						content: message,
					})
					// 广播给所有活跃会话
					for (const client of sessionMap.values()) {
						if (client.readyState === WebSocket.OPEN) {
							client.send(payload)
						}
					}
				})
			}
		}).catch(err => Logger.error("Failed to link MCP notifications", err))

		ws.on("message", async (messageData: any) => {
			// 解决找不到 Buffer 类型的问题：直接通过通用 toString 处理
			const rawText = messageData.toString("utf-8")
			let inputText = rawText
			
			// 尝试解析会话协议包
			try {
				const parsed = JSON.parse(rawText)
				if (parsed.type === "hello" && typeof parsed.sessionId === "string") {
					const sid: string = parsed.sessionId
					currentSessionId = sid
					sessionMap.set(sid, ws)
					Logger.info(`[Auth] Session identified and bound: ${sid}`)
					ws.send(JSON.stringify({ type: "hello_ack", sessionId: sid }))
					return
				}
				if (typeof parsed.sessionId === "string") {
					currentSessionId = parsed.sessionId
				}
				if (parsed.command) inputText = parsed.command
			} catch(e) {
				// 兼容旧的纯文本协议
			}

			Logger.info(`WS message received from [${currentSessionId || 'unknown'}]: ${inputText.substring(0, 50)}...`)

			try {
				// 未来可在 executeCommands 中注入 currentSessionId 以实现执行流隔离
				const response = await executeCommands(inputText)
				ws.send(response)
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				Logger.error(`Error handling WS message`, error)
				ws.send(JSON.stringify({ status: "error", message: errorMessage }))
			}
		})

		ws.on("close", () => {
			Logger.info(`[WS] Client disconnected. Session: ${currentSessionId || "unknown"}`)
			if (currentSessionId) {
				sessionMap.delete(currentSessionId)
			}

			// 仅当没有剩余连接时才清除回调
			if (sessionMap.size === 0) {
				import("../../core/webview").then((module) => {
					const provider = module.WebviewProvider.getInstance()
					provider?.controller?.mcpHub?.clearNotificationCallback()
				}).catch(err => Logger.error("Failed to clear MCP callback", err))
			}
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
