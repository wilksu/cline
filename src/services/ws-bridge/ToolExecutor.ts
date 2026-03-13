/**
 * ToolExecutor - Execute parsed commands
 * Adapted from ws-agent/toolExecutor.ts
 */

import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { BaseTool } from "./BaseTool"
import { parseBatchInput, TOOL_NAMES } from "./CommandParser"
import { Logger } from "./Logger"
import { BrowserTool, FileEditor, LSTool, McpTool, ReadTool, RMTool, RunTool, SearchTool } from "./tools"
import type { ExecutionResult, ToolResult } from "./types"

/**
 * Tool registry - maps command names to tool classes
 */
const TOOL_CLASSES: Record<string, new (root: string) => BaseTool<object>> = {
	ls: LSTool as unknown as new (root: string) => BaseTool<object>,
	read: ReadTool as unknown as new (root: string) => BaseTool<object>,
	search: SearchTool as unknown as new (root: string) => BaseTool<object>,
	run: RunTool as unknown as new (root: string) => BaseTool<object>,
	browser: BrowserTool as unknown as new (root: string) => BaseTool<object>,
	mcp: McpTool as unknown as new (root: string) => BaseTool<object>,
	rm: RMTool as unknown as new (root: string) => BaseTool<object>,
}

/**
 * Execute a batch of commands from input text
 */
export async function executeCommands(inputText: string): Promise<string> {
	const response = await HostProvider.workspace.getWorkspacePaths({})
	const workspacePaths = response.paths
	if (!workspacePaths || workspacePaths.length === 0) {
		return "Error: No workspace open"
	}
	const projectRoot = workspacePaths[0]

	const fileEditor = new FileEditor(projectRoot)

	try {
		Logger.info(`[ToolExecutor] Parsing input...`)
		const commands = parseBatchInput(inputText)

		if (commands.length === 0) {
			Logger.warn(`[ToolExecutor] No valid commands found in input.`)
			throw new Error(
				"No valid commands found. Please check format (e.g. 'read: src/file.ts' or 'action: \"src/file.ts\"').",
			)
		}

		Logger.info(`[ToolExecutor] Processing ${commands.length} commands sequentially`)

		const results: ExecutionResult[] = []

		for (const cmd of commands) {
			// Handle Block Commands (Edit / Write)
			if (cmd.type === "action" && cmd.actionPayload) {
				const { path: fPath, isEdit, content, expectedHash } = cmd.actionPayload
				const targetPath = path.isAbsolute(fPath) ? fPath : path.join(projectRoot, fPath)

				try {
					// Safety check: attempt to save if dirty via host abstraction
					await HostProvider.workspace.saveOpenDocumentIfDirty({ filePath: targetPath })

					let outputMsg = ""

					if (content === undefined) {
						throw new Error("Missing code block for write/edit action.")
					}

					if (isEdit) {
						outputMsg = await fileEditor.applyEdit(fPath, content, expectedHash)
					} else {
						outputMsg = await fileEditor.writeFile(fPath, content, expectedHash)
					}

					Logger.info(`[Action] Success: ${outputMsg}`)
					results.push({
						command: `${isEdit ? "Edit" : "Write"} "${fPath}"`,
						status: "success",
						output: outputMsg,
					})
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e)
					Logger.error(`[Action] Failed: ${fPath}`, e)

					let finalOutput = msg

					if (isEdit) {
						finalOutput = `The edit failed.\nError: ${msg}\n\nPlease issue a 'read: ${fPath}' command to retrieve the latest content and its correct [Hash], then try your edit again.`
					}

					results.push({
						command: `${isEdit ? "Edit" : "Action"} "${fPath}"`,
						status: "error",
						output: finalOutput,
					})
					
					// 🚨 熔断机制 (Fail-Fast): 一旦发生错误，立即停止执行后续命令
					break
				}
			}
			// Handle Tool commands (ls, read, search)
			else if (cmd.type === "tool") {
				try {
					const toolName = TOOL_NAMES[cmd.name] || cmd.name
					const ToolClass = TOOL_CLASSES[toolName]

					if (!ToolClass) {
						// Tool not found in basic registry - could be run/browser/mcp
						// For now, return unsupported message
						results.push({
							command: `${cmd.name}: ${cmd.args?.join(" ")}`,
							status: "error",
							output: `Tool '${cmd.name}' is not yet implemented in ws-bridge. Coming soon: run, browser, mcp.`,
						})
						continue
					}

					const tool = new ToolClass(projectRoot)
					const params = tool.parseCliArgs(cmd.args || [])

					Logger.info(`[ToolExecutor] Executing ${cmd.name}`, params)
					const result: ToolResult = await tool.execute(params)

					const entry: ExecutionResult = {
						command: `${cmd.name}: ${cmd.args?.join(" ")}`,
						status: "success",
						output: result.llmContent,
						data: result.data,
					}
					results.push(entry)
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e)
					Logger.error(`[ToolExecutor] Command failed: ${cmd.name}`, e)
					results.push({ command: cmd.name, status: "error", output: msg })
					
					// 🚨 熔断机制 (Fail-Fast)
					break
				}
			}
		}

		// 采用结构化 JSON 协议返回
		return JSON.stringify({
			type: "batch_result",
			results: results
		})
	} catch (error) {
		Logger.error(`[ToolExecutor] Fatal Error`, error)
		return JSON.stringify({
			type: "fatal_error",
			error: error instanceof Error ? error.message : String(error)
		})
	}
}
