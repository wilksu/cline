/**
 * McpTool - Call MCP tools
 * Reuses McpHub via WebviewProvider
 */

import { WebviewProvider } from "@/core/webview"
import { BaseTool } from "../BaseTool"
import type { ToolResult } from "../types"
import { getErrorMessage } from "../utils"

export interface McpParams {
	server_name: string
	tool_name: string
	arguments?: Record<string, unknown>
}

export class McpTool extends BaseTool<McpParams> {
	static readonly Name = "mcp"

	constructor(workspaceRoot: string) {
		super(McpTool.Name, "Call MCP tool", workspaceRoot)
	}

	parseCliArgs(args: string[]): McpParams {
		// Expects: mcp <server_name> <tool_name> <json_args>
		if (args.length < 2) {
			throw new Error("Usage: mcp <server_name> <tool_name> [json_args]")
		}

		const serverName = args[0]
		const toolName = args[1]
		let toolArgs = {}

		if (args.length > 2) {
			try {
				const jsonStr = args.slice(2).join(" ")
				toolArgs = JSON.parse(jsonStr)
			} catch (e) {
				throw new Error(`Invalid JSON arguments: ${getErrorMessage(e)}`)
			}
		}

		return {
			server_name: serverName,
			tool_name: toolName,
			arguments: toolArgs,
		}
	}

	async execute(params: McpParams): Promise<ToolResult> {
		try {
			// Access global McpHub instance
			const provider = WebviewProvider.getInstance()
			if (!provider || !provider.controller) {
				throw new Error("Cline controller not initialized")
			}

			const mcpHub = provider.controller.mcpHub
			if (!mcpHub) {
				throw new Error("McpHub not available")
			}

			// Use a generic ULID for ws-bridge calls
			const result = await mcpHub.callTool(params.server_name, params.tool_name, params.arguments, "ws-bridge-task")

			let content = ""
			if (result.isError) {
				content = `MCP Tool Error:\n${JSON.stringify(result.content, null, 2)}`
			} else {
				// Format content blocks
				content = result.content
					.map((c) => {
						if (c.type === "text") return c.text
						if (c.type === "image") return `[Image]`
						return `[${c.type}]`
					})
					.join("\n")
			}

			return {
				llmContent: content,
				returnDisplay: `Called ${params.tool_name}`,
				data: result,
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			return {
				llmContent: `MCP call failed: ${msg}`,
				returnDisplay: "Error",
				error: { message: msg },
			}
		}
	}
}
