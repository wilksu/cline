/**
 * McpTool - Call MCP tools
 * Reuses McpHub via WebviewProvider
 */

import { WebviewProvider } from "@/core/webview"
import { BaseTool } from "../BaseTool"
import type { ToolResult } from "../types"
import { getErrorMessage } from "../utils"

export interface McpParams {
	action: "list" | "info" | "call"
	server_name?: string
	tool_name?: string
	arguments?: Record<string, unknown>
}

export class McpTool extends BaseTool<McpParams> {
	static readonly Name = "mcp"

	constructor(workspaceRoot: string) {
		super(McpTool.Name, "Interact with MCP servers", workspaceRoot)
	}

	parseCliArgs(args: string[]): McpParams {
		if (args.length === 0) return { action: "list" }

		const subCommand = args[0].toLowerCase()

		if (subCommand === "list") {
			return { action: "list" }
		}

		if (subCommand === "info") {
			if (args.length < 2) throw new Error("Usage: mcp: info <server_name>")
			return { action: "info", server_name: args[1] }
		}

		// Support both 'mcp: call server tool {}' and implicit 'mcp: server tool {}'
		const isExplicitCall = subCommand === "call"
		const offset = isExplicitCall ? 1 : 0
		
		if (args.length < offset + 2) {
			throw new Error("Usage: mcp: [call] <server_name> <tool_name> [json_args]")
		}

		const serverName = args[offset]
		const toolName = args[offset + 1]
		let toolArgs = {}

		if (args.length > offset + 2) {
			try {
				const jsonStr = args.slice(offset + 2).join(" ")
				toolArgs = JSON.parse(jsonStr)
			} catch (e) {
				throw new Error(`Invalid JSON arguments: ${getErrorMessage(e)}`)
			}
		}

		return {
			action: "call",
			server_name: serverName,
			tool_name: toolName,
			arguments: toolArgs,
		}
	}

	async execute(params: McpParams): Promise<ToolResult> {
		try {
			const provider = WebviewProvider.getInstance()
			if (!provider || !provider.controller) {
				throw new Error("Cline controller not initialized")
			}

			const mcpHub = provider.controller.mcpHub
			if (!mcpHub) {
				throw new Error("McpHub not available")
			}

			// 1. Handle LIST: Show all enabled servers
			if (params.action === "list") {
				const servers = mcpHub.getServers()
				const output = servers.length > 0 
					? "Connected MCP Servers:\n" + servers.map(s => `- ${s.name} (${s.status})`).join("\n")
					: "No MCP servers connected."
				return {
					llmContent: output,
					returnDisplay: "Listed MCP servers",
					data: servers
				}
			}

			// 2. Handle INFO: Show tools and schemas for a specific server
			if (params.action === "info") {
				const server = mcpHub.getServers().find(s => s.name === params.server_name)
				if (!server) throw new Error(`Server "${params.server_name}" not found or disabled.`)

				const tools = server.tools || []
				const toolsHelp = tools
					.map((t) => {
						const status = t.autoApprove ? "[Auto-Approve: ON]" : "[Requires Approval]"
						return `### ${t.name} ${status}\n${t.description}\nSchema: ${JSON.stringify(t.inputSchema, null, 2)}`
					})
					.join("\n\n")

				return {
					llmContent: `Tools for "${server.name}":\n\n${toolsHelp}`,
					returnDisplay: `Explored ${server.name}`,
					data: tools,
				}
			}

			// 3. Handle CALL: Execute a tool
			if (params.action === "call") {
				if (!params.server_name || !params.tool_name) throw new Error("Server name and tool name are required.")
				
				const server = mcpHub.getServers().find(s => s.name === params.server_name)
				if (!server) throw new Error(`Server "${params.server_name}" not found.`)

				const tool = (server.tools || []).find((t) => t.name === params.tool_name)
				if (!tool) throw new Error(`Tool "${params.tool_name}" not found on server "${params.server_name}".`)

				// Security Pre-check: Headless mode requires auto-approve
				if (!tool.autoApprove) {
					throw new Error(`MCP Tool "${params.tool_name}" is NOT set to auto-approve. In ws-bridge (headless mode), you can only call tools that the user has pre-approved. Please ask the user to enable auto-approve for this tool in the Cline MCP settings.`)
				}

				const result = await mcpHub.callTool(params.server_name, params.tool_name, params.arguments, "ws-bridge-task")

				let content = ""
				if (result.isError) {
					content = `MCP Tool Error:\n${JSON.stringify(result.content, null, 2)}`
				} else {
					content = result.content
						.map((c) => {
							if (c.type === "text") return c.text
							if (c.type === "image") return `[Image: MCP returned binary data]`
							return `[${c.type}]`
						})
						.join("\n")
				}

				return {
					llmContent: content,
					returnDisplay: `Executed ${params.server_name}:${params.tool_name}`,
					data: result,
				}
			}

			throw new Error(`Unknown action: ${params.action}`)
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
