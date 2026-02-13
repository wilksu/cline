/**
 * WsBridge Module - Browser automation via WebSocket
 *
 * This module provides WebSocket-based communication between
 * browser (via Tampermonkey script) and Cline for executing
 * coding automation commands.
 *
 * Usage:
 *   import { WsBridge } from "@/services/ws-bridge"
 *   WsBridge.start(3456)
 *   WsBridge.stop()
 */

import * as vscode from "vscode"
import { HostProvider } from "@/hosts/host-provider"
import { getWorkspaceIgnoreController } from "./ignore"
import { Logger } from "./Logger"
import { getWsBridgeConfig } from "./utils"
import * as WsBridgeServer from "./WsBridgeServer"

export const WsBridge = {
	/**
	 * Start the WebSocket bridge server
	 */
	async start(port?: number): Promise<void> {
		const configPort = port ?? getWsBridgeConfig<number>("port", 3456)
		WsBridgeServer.startServer(configPort)

		// Pre-warm the Ignore Controller to ensure .clineignore is generated immediately upon startup
		try {
			const response = await HostProvider.workspace.getWorkspacePaths({})
			if (response.paths && response.paths.length > 0) {
				await getWorkspaceIgnoreController(response.paths[0])
				Logger.info("Ignore controller pre-warmed.")
			}
		} catch (e) {
			Logger.warn("Failed to pre-warm ignore controller", e)
		}
	},

	/**
	 * Stop the WebSocket bridge server
	 */
	stop(): void {
		WsBridgeServer.stopServer()
	},

	/**
	 * Check if the server is running
	 */
	isRunning(): boolean {
		return WsBridgeServer.isRunning()
	},

	/**
	 * Dispose all resources
	 */
	dispose(): void {
		WsBridgeServer.dispose()
		Logger.dispose()
	},

	/**
	 * Register commands and auto-start if configured
	 */
	register(context: vscode.ExtensionContext): void {
		// Register commands
		context.subscriptions.push(
			// biome-ignore lint/plugin: Extension entry point must use vscode.commands.registerCommand
			vscode.commands.registerCommand("cline.wsBridge.start", async () => {
				await this.start()
			}),
		)

		context.subscriptions.push(
			// biome-ignore lint/plugin: Extension entry point must use vscode.commands.registerCommand
			vscode.commands.registerCommand("cline.wsBridge.stop", () => {
				this.stop()
			}),
		)

		// Register disposable
		context.subscriptions.push({
			dispose: () => this.dispose(),
		})

		// Auto-start if configured
		const autoStart = getWsBridgeConfig<boolean>("autoStart", false)
		if (autoStart) {
			Logger.info("Auto-starting WsBridge...")
			this.start()
		}
	},
}

export { parseBatchInput, TOOL_NAMES } from "./CommandParser"
export { Logger } from "./Logger"
export { executeCommands } from "./ToolExecutor"
// Export types and utilities
export type { ActionPayload, ExecutionResult, ParsedCommand, ToolResult, WsBridgeConfig } from "./types"
