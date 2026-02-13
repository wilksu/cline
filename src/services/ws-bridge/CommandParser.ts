/**
 * CommandParser - Parse ws-agent style commands from input text
 * Migrated and adapted from ws-agent/toolExecutor.ts
 */

import { Logger } from "./Logger"
import type { ActionPayload, ParsedCommand } from "./types"

/**
 * Registry of command name aliases
 */
export const TOOL_NAMES: Record<string, string> = {
	ls: "ls",
	list: "ls",
	dir: "ls",
	read: "read",
	cat: "read",
	read_file: "read",
	search: "search",
	grep: "search",
	find: "search",
	run: "run",
	exec: "run",
	cmd: "run",
	browser: "browser",
	mcp: "mcp",
	symbol: "symbol",
	rm: "rm",
	delete: "rm",
	remove: "rm",
}

function tokenize(input: string): string[] {
	const normalized = input.trim()
	const regex = /[^\s"']+|"([^"]*)"|'([^']*)'/g
	const args: string[] = []
	for (let match = regex.exec(normalized); match !== null; match = regex.exec(normalized)) {
		const val = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[0]
		args.push(val)
	}
	return args
}

function trimQuotes(s: string): string {
	const m = s.match(/^([`'"])(.*)\\1$/)
	return m ? m[2] : s
}

function stripListMarkers(line: string): string {
	return line.replace(/^(\s*[-*]|\s*\d+\.)\s+/, "")
}

/**
 * Remove  blocks
 */
function stripThinkingBlocks(input: string): string {
	return input.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim()
}

/**
 * Extract path and alphanumeric hash from the end of a string
 * Format: path/to/file.ts[A1B2C3]
 * Search from the back to safely handle paths with special characters.
 */
export function extractPathAndHash(input: string): { path: string; hash?: string } {
	const lastBracketClose = input.lastIndexOf("]")
	if (lastBracketClose === input.length - 1) {
		const lastBracketOpen = input.lastIndexOf("[")
		if (lastBracketOpen !== -1 && lastBracketOpen < lastBracketClose) {
			const hashContent = input.substring(lastBracketOpen + 1, lastBracketClose)
			// Ensure hash strictly contains only letters and numbers
			if (/^[a-zA-Z0-9]+$/.test(hashContent)) {
				return {
					path: input.substring(0, lastBracketOpen).trim(),
					hash: hashContent,
				}
			}
		}
	}
	return { path: input.trim() }
}

/**
 * Parse batch input into commands
 */
export function parseBatchInput(input: string): ParsedCommand[] {
	const commands: ParsedCommand[] = []
	const cleanedInput = stripThinkingBlocks(input)
	const lines = cleanedInput.split(/\r?\n/)
	const fenceExtractorRegex = /^(```+|~~~+)/

	Logger.debug(`Parsing ${lines.length} lines of input...`)

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = trimQuotes(line.trim())
		if (!trimmed) {
			continue
		}

		// Try to parse as 'write:' or 'edit:' (Block Commands)
		const actionRegex = /^(write|edit):\s+["']?(.*?)["']?$/i
		const actionMatch = trimmed.match(actionRegex)

		if (actionMatch) {
			const commandType = actionMatch[1].toLowerCase()
			let rawFilePath = actionMatch[2].trim()
			const isEdit = commandType === "edit"

			if (rawFilePath.includes("\\_")) {
				rawFilePath = rawFilePath.replace(/\\_/g, "_")
			}

			const { path: filePath, hash: expectedHash } = extractPathAndHash(rawFilePath)

			Logger.debug(
				`[Parser] Line ${i + 1}: Detected ${commandType.toUpperCase()} - ${filePath} (Hash: ${expectedHash || "none"})`,
			)

			let content: string | undefined
			let fence: string | undefined
			const contentLines: string[] = []
			let foundBlock = false

			for (let j = i + 1; j < lines.length; j++) {
				const nextLine = lines[j]
				const trimmedNext = nextLine.trim()

				if (fence === undefined) {
					if (trimmedNext.length === 0) {
						continue
					}
					const fenceMatch = trimmedNext.match(fenceExtractorRegex)
					if (fenceMatch) {
						fence = fenceMatch[1]
						foundBlock = true
					} else {
						Logger.warn(
							`[Parser] Command '${commandType}' for '${filePath}' followed by non-fence text: "${trimmedNext}"`,
						)
						throw new Error(
							`Command '${commandType}' for '${filePath}' is missing a code block. Found text instead: "${trimmedNext}"`,
						)
					}
				} else {
					if (trimmedNext === fence) {
						content = contentLines.join("\n")
						i = j
						break
					} else {
						contentLines.push(nextLine)
					}
				}
			}

			if (!foundBlock) {
				Logger.warn(`[Parser] Command '${commandType}' for '${filePath}' reached end of input without code block.`)
				throw new Error(`Command '${commandType}' for '${filePath}' is missing a code block.`)
			}

			const actionPayload: ActionPayload = { path: filePath, isEdit, content, expectedHash }
			commands.push({
				type: "action",
				name: isEdit ? "edit" : "write",
				actionPayload,
			})
			continue
		}

		// Try to parse as tool command
		const cleanLine = stripListMarkers(trimmed)
		const toolRegex = /^(\w+):(\s+[\s\S]*)?$/i
		const toolMatch = cleanLine.match(toolRegex)

		if (toolMatch) {
			const cmdName = toolMatch[1].toLowerCase()
			const rawArgsString = toolMatch[2] ? toolMatch[2].trim() : ""

			if (TOOL_NAMES[cmdName]) {
				const rawArgs = tokenize(rawArgsString)
				const args = rawArgs.map((arg) => {
					const cleanArg = arg.replace(/\\_/g, "_")
					// Strip hash so underlying tools (like ReadTool) get the pure file path
					return extractPathAndHash(cleanArg).path
				})

				const jsonIndex = args.indexOf("--json")
				let outputJson = false
				if (jsonIndex !== -1) {
					outputJson = true
					args.splice(jsonIndex, 1)
				}

				Logger.debug(`[Parser] Line ${i + 1}: Detected Tool - ${cmdName}: [${args.join(", ")}]`)
				commands.push({ type: "tool", name: TOOL_NAMES[cmdName], args, outputJson })
				continue
			}
		}

		Logger.debug(`[Parser] Line ${i + 1}: Ignored (Not a command) - "${trimmed.substring(0, 50)}..."`)
	}

	return commands
}
