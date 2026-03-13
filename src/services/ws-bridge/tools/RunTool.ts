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
			// Priority: Env CLINE_PAGER > 'cat'
			const pager = process.env.CLINE_PAGER || "cat"
			const term = process.env.CLINE_TERM || "dumb"

			const wrappedCommand =
				process.platform === "win32"
					? `$env:PAGER='${pager}'; $env:TERM='${term}'; ${params.command}`
					: `PAGER=${pager} TERM=${term} ${params.command}`

			const process = terminalManager.runCommand(terminalInfo, wrappedCommand)

			const outputLines: string[] = []

			process.on("line", (line) => {
				outputLines.push(line)
			})

			// Wait for completion
			await process

			const output = outputLines.join("\n")

			// --- Dynamic Configuration ---
			const stateManager = StateManager.get()
			
			// 1. Resolve Output Limit: Env > User Setting > Default (30k)
			const envLimit = process.env.CLINE_RUN_OUTPUT_LIMIT ? parseInt(process.env.CLINE_RUN_OUTPUT_LIMIT) : NaN
			const userLimit = stateManager.getGlobalSettingsKey("terminalOutputLineLimit") // Existing UI setting
			// Note: userLimit is usually in lines, we convert to chars approximately (1 line ≈ 100 chars) or use as-is if it's a new setting
			const LIMIT = !isNaN(envLimit) ? envLimit : (userLimit ? userLimit * 100 : 30000)

			const truncatedOutput =
				output.length > LIMIT ? `...[truncated ${output.length - LIMIT} chars]...\n` + output.substring(output.length - LIMIT) : output

			return {
				llmContent: truncatedOutput || "Command executed successfully (no output).",
				returnDisplay: `Executed: ${params.command}`,
				data: { exitCode: 0, output },
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
