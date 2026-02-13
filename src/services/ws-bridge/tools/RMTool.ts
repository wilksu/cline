/**
 * RMTool - Remove files (wrapper for FileEditor.deleteFile)
 */

import { BaseTool } from "../BaseTool"
import { ToolResult } from "../types"
import { getErrorMessage } from "../utils"
import { FileEditor } from "./FileEditor"

export interface RMParams {
	path: string
}

export class RMTool extends BaseTool<RMParams> {
	static readonly Name = "rm"

	constructor(workspaceRoot: string) {
		super(RMTool.Name, "Remove file", workspaceRoot)
	}

	parseCliArgs(args: string[]): RMParams {
		if (args.length === 0) {
			throw new Error("Usage: rm <path>")
		}
		return { path: args[0] }
	}

	async execute(params: RMParams): Promise<ToolResult> {
		try {
			const fileEditor = new FileEditor(this.workspaceRoot)
			const output = await fileEditor.deleteFile(params.path)

			return {
				llmContent: output,
				returnDisplay: output,
				data: { deleted: params.path },
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			return {
				llmContent: `Failed to remove ${params.path}: ${msg}`,
				returnDisplay: "Error",
				error: { message: msg },
			}
		}
	}
}
