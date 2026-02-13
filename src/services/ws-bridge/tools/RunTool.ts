/**
 * RunTool - Execute terminal commands
 * Leverages HostProvider to run commands in VS Code terminal
 */

import { CommandPermissionController } from "@/core/permissions/CommandPermissionController"
import { StateManager } from "@/core/storage/StateManager"
import { HostProvider } from "@/hosts/host-provider"
import { BaseTool } from "../BaseTool"
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
			// 1. Check Global Permission Controller (Env Vars)
			const permissionResult = this.permissionController.validateCommand(params.command)
			if (!permissionResult.allowed) {
				throw new Error(`Command denied by CLINE_COMMAND_PERMISSIONS. Reason: ${permissionResult.reason}`)
			}

			// 2. Check User Auto-Approval Settings
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

			const process = terminalManager.runCommand(terminalInfo, params.command)

			const outputLines: string[] = []

			process.on("line", (line) => {
				outputLines.push(line)
			})

			// Wait for completion
			await process

			const output = outputLines.join("\n")
			// Truncate if too long (similar to Cline's internal limits)
			const truncatedOutput = output.length > 5000 ? output.substring(0, 5000) + "\n...[truncated]..." : output

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
