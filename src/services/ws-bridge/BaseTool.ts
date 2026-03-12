import { ClineIgnoreController } from "@/core/ignore/ClineIgnoreController"
import { getWorkspaceIgnoreController } from "./ignore"
import type { ToolResult } from "./types"

/**
 * Base class for tools that can be executed via WebSocket commands
 */
export abstract class BaseTool<TParams extends object> {
	constructor(
		public readonly name: string,
		public readonly description: string,
		public readonly workspaceRoot: string,
	) {}

	/**
	 * Execute the tool with given parameters
	 */
	abstract execute(params: TParams): Promise<ToolResult>

	/**
	 * Parse CLI-style arguments into structured parameters
	 */
	abstract parseCliArgs(args: string[]): TParams

	/**
	 * Validate parameters before execution
	 * Returns error message if invalid, null if valid
	 */
	validate(_params: TParams): string | null {
		return null
	}

	/**
	 * Gets the native ClineIgnoreController for the current workspace.
	 */
	protected async getIgnoreController(): Promise<ClineIgnoreController> {
		return getWorkspaceIgnoreController(this.workspaceRoot)
	}

	/**
	 * Checks if a path should be ignored based on the native .clineignore rules.
	 */
	protected isPathIgnored(controller: ClineIgnoreController, fullPath: string): boolean {
		// validateAccess returns true if allowed (not ignored), false if ignored
		return !controller.validateAccess(fullPath)
	}
}
