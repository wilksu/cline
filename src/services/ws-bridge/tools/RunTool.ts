/**
 * RunTool - Execute terminal commands
 * Leverages HostProvider to run commands in VS Code terminal
 */

import { CommandPermissionController } from "@/core/permissions/CommandPermissionController"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { BaseTool } from "../BaseTool"
import { getWorkspaceIgnoreController } from "../ignore"
import type { ToolResult } from "../types"
import { getErrorMessage } from "../utils"

export interface RunParams {
	command: string
}

export class RunTool extends BaseTool<RunParams> {
	static readonly Name = "run"
	private permissionController: CommandPermissionController

	constructor(workspaceRoot: string) {
		super(RunTool.Name, "Run terminal command", workspaceRoot)
		this.permissionController = new CommandPermissionController()
	}

	parseCliArgs(args: string[]): RunParams {
		if (args.length === 0) {
			throw new Error("Usage: run <command>")
		}
		// Join all arguments to form the command
		return { command: args.join(" ") }
	}

	async execute(params: RunParams): Promise<ToolResult> {
		try {
			// 1. Check Global Permission Controller (Command Blacklist/Whitelist)
			const permissionResult = this.permissionController.validateCommand(params.command)
			if (!permissionResult.allowed) {
				throw new Error(`Command denied by CLINE_COMMAND_PERMISSIONS. Reason: ${permissionResult.reason}`)
			}

			// 2. Check native ClineIgnore rules (Prevent `cat .env` bypass)
			const ignoreController = await getWorkspaceIgnoreController(this.workspaceRoot)
			const ignoredFileAttemptedToAccess = ignoreController.validateCommand(params.command)
			if (ignoredFileAttemptedToAccess) {
				throw new Error(`Command execution denied. Attempted to access ignored file: ${ignoredFileAttemptedToAccess}`)
			}

			// 3. Check User Auto-Approval Settings
			const stateManager = StateManager.get()
			const autoApprovalSettings = stateManager.getGlobalSettingsKey("autoApprovalSettings")

			// In headless mode, we can only execute if 'executeAllCommands' is enabled,
			// or if we could determine the command is "safe" AND 'executeSafeCommands' is enabled.
			// Since "safe" is subjective and we can't ask the user, we default to stricter checking.
			// For now, we rely on 'executeAllCommands' for true headless freedom, or the env var whitelist.

			const canExecute = autoApprovalSettings?.actions?.executeAllCommands || false

			if (!canExecute) {
				// If not globally allowed, check if it's implicitly allowed by being in the permission whitelist
				// The PermissionController returns 'no_config' if no rules are set.
				// If rules ARE set and it passed validateCommand (matched 'allow'), we can consider it safe.
				const explicitlyAllowedByEnv = permissionResult.reason === "allowed" // Matched an allow pattern

				if (!explicitlyAllowedByEnv) {
					throw new Error(
						"Command execution denied. Please enable 'Always approve execution of all commands' in Cline settings, or configure CLINE_COMMAND_PERMISSIONS allow-list.",
					)
				}
			}

			const terminalManager = HostProvider.get().createTerminalManager()
			const terminalInfo = await terminalManager.getOrCreateTerminal(this.workspaceRoot)

			// Show the terminal to the user
			terminalInfo.terminal.show()

			// Wrap command to prevent interactive pagers (less, more) and clear styling
			const pager = process.env.CLINE_PAGER || "cat"
			const term = process.env.CLINE_TERM || "dumb"

			// Use simpler cross-platform execution or rely on terminal's default shell
			// For Windows, prepending variables directly can crash if the shell is cmd.exe instead of PS.
			// Let's pass the raw command, and try to handle pager issues if they arise later, 
			// or use a cross-env like approach. For now, sending the raw command is safest.
			let envPrefix = ""
			if (process.platform !== "win32") {
				envPrefix = `PAGER=${pager} TERM=${term} `
			}
			const wrappedCommand = `${envPrefix}${params.command}`

			const commandProcess = terminalManager.runCommand(terminalInfo, wrappedCommand)

			// --- Dynamic Configuration & Output Management ---
			const _stateManager = StateManager.get()
			const envLimit = process.env.CLINE_RUN_OUTPUT_LIMIT ? parseInt(process.env.CLINE_RUN_OUTPUT_LIMIT) : NaN
			const userLimit = _stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
			
			// Use byte-based limit for safety (consistent with ReadTool)
			const MAX_OUTPUT_BYTES = !isNaN(envLimit) ? envLimit : (userLimit ? userLimit * 500 : 256 * 1024) // Default 256KB

			const outputLines: string[] = []
			let totalBytes = 0

			commandProcess.on("line", (line: string) => {
				const lineBytes = Buffer.byteLength(line, 'utf8') + 1
				if (totalBytes + lineBytes > MAX_OUTPUT_BYTES) {
					// If we hit the limit, we keep the most recent output
					if (outputLines.length > 0) {
						const removed = outputLines.shift()
						if (removed) totalBytes -= (Buffer.byteLength(removed, 'utf8') + 1)
					}
				}
				outputLines.push(line)
				totalBytes += lineBytes
			})

			// 🚨 Intelligent Timeout Mechanism
			// If a command (like `npm run dev`) blocks, we shouldn't hang the LLM bridge.
			const TIMEOUT_MS = 15000 // 15 seconds
			
			let isTimeout = false
			try {
				await Promise.race([
					commandProcess,
					new Promise((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_MS))
				])
			} catch (err: any) {
				if (err.message === "TIMEOUT") {
					isTimeout = true
				} else {
					throw err
				}
			}

			const output = outputLines.join("\n")
			const isTruncated = totalBytes >= MAX_OUTPUT_BYTES

			let finalLlmContent = output || "Command executed successfully (no output)."
			
			if (isTruncated) {
				finalLlmContent = `[NOTICE: Output truncated due to ${MAX_OUTPUT_BYTES / 1024}KB limit]\n...\n${finalLlmContent}`
			}

			if (isTimeout) {
				finalLlmContent += "\n\n[SYSTEM NOTE: Command is still running. You can continue with other tasks or wait for further output in the next turn.]"
			}

			return {
				llmContent: finalLlmContent,
				returnDisplay: `Executed: ${params.command}${isTimeout ? ' (Background)' : ''}`,
				data: { exitCode: isTimeout ? null : 0, output },
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			return {
				llmContent: `Command failed: ${msg}`,
				returnDisplay: "Command failed",
				error: { message: msg },
			}
		}
	}
}
