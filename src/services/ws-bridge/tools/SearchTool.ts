/**
 * SearchTool - Search text in files
 * Migrated from ws-agent
 */

import * as path from "path"
import { regexSearchFiles } from "@/services/ripgrep"
import { BaseTool } from "../BaseTool"
import { Logger } from "../Logger"
import type { ToolResult } from "../types"
import { getErrorMessage, isPathWithinWorkspace, makeRelative } from "../utils"

export interface SearchParams {
	pattern: string
	paths?: string[]
	include?: string
}

export class SearchTool extends BaseTool<SearchParams> {
	static readonly Name = "search"

	constructor(workspaceRoot: string) {
		super(SearchTool.Name, "Search text in files", workspaceRoot)
	}

	parseCliArgs(args: string[]): SearchParams {
		if (args.length === 0) {
			throw new Error("Usage: search <pattern> [path...]")
		}

		const params: SearchParams = {
			pattern: "",
			paths: [],
		}

		for (let i = 0; i < args.length; i++) {
			const arg = args[i]
			if (arg === "--include" || arg === "-i") {
				params.include = args[++i]
			} else if (!arg.startsWith("-")) {
				if (!params.pattern) {
					params.pattern = arg
				} else {
					params.paths!.push(arg)
				}
			}
		}

		if (!params.pattern) {
			throw new Error("Usage: search <pattern> [path...]")
		}

		return params
	}

	async execute(params: SearchParams): Promise<ToolResult> {
		try {
			const searchPattern = params.pattern
			const searchPaths = params.paths && params.paths.length > 0 ? params.paths : ["."]

			// Filter valid paths within workspace
			const validPaths: string[] = []
			for (const p of searchPaths) {
				const absPath = path.isAbsolute(p) ? p : path.join(this.workspaceRoot, p)
				if (!isPathWithinWorkspace(absPath, this.workspaceRoot)) {
					Logger.warn(`Skipping search path outside workspace: ${absPath}`)
					continue
				}
				validPaths.push(absPath)
			}

			if (validPaths.length === 0) {
				throw new Error("No valid search paths provided within workspace.")
			}

			// We use the first path as the search directory, assuming simpler usage for now.
			// The regexSearchFiles (ripgrep wrapper) usually takes a single directory.
			// If multiple paths are provided, we might need to iterate or refine.
			// For this implementation, we search in the first valid path and filter by include pattern if provided.
			const searchDir = validPaths[0]
			const relativeSearchDir = makeRelative(searchDir, this.workspaceRoot)

			Logger.info(`[SearchTool] Searching for "${searchPattern}" in ${relativeSearchDir}`)

			// Reuse Cline's ripgrep service
			// regexSearchFiles(cwd, directoryPath, regex, filePattern)
			const output = await regexSearchFiles(
				this.workspaceRoot,
				searchDir,
				searchPattern,
				params.include, // filePattern
			)

			// Simple check if output contains actual results or just "Found 0 results"
			const hasResults =
				output.includes("│") ||
				output.includes("Found 1") ||
				(output.match(/Found \d+ results/) && !output.includes("Found 0 results"))
			const summary = hasResults ? `Search completed for "${searchPattern}"` : `No matches found for "${searchPattern}"`

			return {
				llmContent: output,
				returnDisplay: summary,
				data: output, // Raw output for now
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			Logger.error(`[SearchTool] Failed`, error)
			return {
				llmContent: `Search failed: ${msg}`,
				returnDisplay: `Error: ${msg}`,
				error: { message: msg },
			}
		}
	}
}
