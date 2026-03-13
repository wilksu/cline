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
	// Match: 1. Double quoted strings 2. Single quoted strings 3. Unquoted space-separated words
	const regex = /"([^"]*)"|'([^']*)'|[^\s"']+/g
	const args: string[] = []
	let match
	while ((match = regex.exec(normalized)) !== null) {
		// match[0] is the full text including the quotes if present
		args.push(match[0])
	}
	return args
}

function trimQuotes(s: string): string {
	// Only strip if the string starts and ends with the SAME quote character
	// and there are no other instances of that quote at the very start/end
	const m = s.match(/^(['"`])([\s\S]*)\1$/)
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
 * Extract path and alphanumeric hash from the end of a string.
 * Supports format: path/to/file.ts[A1B2C3]
 * Optimized to handle paths containing brackets (e.g., Next.js [id].tsx).
 */
export function extractPathAndHash(input: string): { path: string; hash?: string } {
	const trimmed = input.trim()

	// 1. Check for hash at the very end (handles: path/to/file[HASH] or "path/to/file"[HASH])
	// The greedy ([\s\S]+) ensures we capture the longest possible path,
	// treating only the LAST bracketed alphanumeric block as the hash.
	const endMatch = trimmed.match(/^([\s\S]+)\[([a-zA-Z0-9]+)\]$/)
	if (endMatch) {
		return {
			path: trimQuotes(endMatch[1].trim()),
			hash: endMatch[2],
		}
	}

	// 2. Check if the hash was inside quotes (handles: "path/to/file[HASH]")
	const unquoted = trimQuotes(trimmed)
	const innerMatch = unquoted.match(/^([\s\S]+)\[([a-zA-Z0-9]+)\]$/)
	if (innerMatch) {
		return {
			path: innerMatch[1].trim(),
			hash: innerMatch[2],
		}
	}

	return { path: unquoted }
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
		// Handle cases where the entire line is wrapped in quotes by some LLMs
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
				const isShellCmd = cmdName === "run" || cmdName === "exec" || cmdName === "cmd"

				const args = rawArgs.map((arg) => {
					let cleanArg = arg.replace(/\\_/g, "_")

					// If it's NOT a shell command, we need to strip quotes for FS operations
					if (!isShellCmd) {
						cleanArg = trimQuotes(cleanArg)
					}

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
