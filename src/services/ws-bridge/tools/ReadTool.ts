import * as fs from "fs/promises"
import * as path from "path"
import { TextDecoder } from "util"
import { StateManager } from "@/core/storage/StateManager"
import { BaseTool } from "../BaseTool"
import { Logger } from "../Logger"
import type { ToolResult } from "../types"
import { getErrorMessage, isPathWithinWorkspace, makeRelative, mapAsync } from "../utils"

/**
 * Checks if a buffer contains binary data (contains null bytes)
 */
function isBinary(buffer: Buffer): boolean {
	// Check first 8KB for null bytes
	const checkLength = Math.min(buffer.length, 8192)
	for (let i = 0; i < checkLength; i++) {
		if (buffer[i] === 0) return true
	}
	return false
}

export interface ReadParams {
	paths: string[]
	include?: string
	exclude?: string
	offset?: number
	limit?: number
}

export class ReadTool extends BaseTool<ReadParams> {
	static readonly Name = "read"

	constructor(workspaceRoot: string) {
		super(ReadTool.Name, "Read file content(s)", workspaceRoot)
	}

	parseCliArgs(args: string[]): ReadParams {
		const params: ReadParams = { paths: [] }

		for (let i = 0; i < args.length; i++) {
			const arg = args[i]
			if (arg === "--include" || arg === "-i") {
				params.include = args[++i]
			} else if (arg === "--exclude" || arg === "-e") {
				params.exclude = args[++i]
			} else if (arg === "--offset") {
				params.offset = parseInt(args[++i])
			} else if (arg === "--limit") {
				params.limit = parseInt(args[++i])
			} else if (arg.startsWith("--")) {
				// ignore
			} else {
				params.paths.push(arg)
			}
		}

		if (params.paths.length === 0 && !params.include) {
			throw new Error("Usage: read: <path...> [--include pattern]")
		}
		return params
	}

	async execute(params: ReadParams): Promise<ToolResult> {
		try {
			const filePathsToRead: string[] = []
			const explicitFolders: string[] = []

			// Use native ClineIgnoreController
			const ignoreController = await this.getIgnoreController()

			const maxFileSizeMB = 2
			const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024
			
			// --- Dynamic Configuration ---
			const stateManager = StateManager.get()
			const envLimit = process.env.CLINE_RUN_OUTPUT_LIMIT ? parseInt(process.env.CLINE_RUN_OUTPUT_LIMIT) : NaN
			const userLimit = stateManager.getGlobalSettingsKey("terminalOutputLineLimit")
			// Default to 350KB (approx 3500 lines) if no config, consistent with CLI limits
			const MAX_TOTAL_SIZE = !isNaN(envLimit) ? envLimit : (userLimit ? userLimit * 200 : 350 * 1024)

			for (const p of params.paths) {
				const absPath = path.isAbsolute(p) ? p : path.join(this.workspaceRoot, p)

				if (!isPathWithinWorkspace(absPath, this.workspaceRoot)) {
					continue
				}

				// Apply manual exclude flag if provided via CLI args
				if (params.exclude && absPath.includes(params.exclude.replace("*", ""))) {
					continue
				}

				// Check if this path is ignored by .clineignore
				if (this.isPathIgnored(ignoreController, absPath)) {
					continue
				}

				try {
					const stat = await fs.stat(absPath)
					if (stat.isFile()) {
						filePathsToRead.push(absPath)
					} else if (stat.isDirectory()) {
						explicitFolders.push(absPath)
					}
				} catch {
					// ignore missing files
				}
			}

			// Handle folder expansion (shallow)
			for (const folderPath of explicitFolders) {
				try {
					const children = await fs.readdir(folderPath, { withFileTypes: true })
					for (const dirent of children) {
						const name = dirent.name
						if (name.startsWith(".")) continue

						const fullPath = path.join(folderPath, name)
						const isDir = dirent.isDirectory()

						// Apply manual exclude flag for folder children
						if (params.exclude && fullPath.includes(params.exclude.replace("*", ""))) {
							continue
						}

						if (this.isPathIgnored(ignoreController, fullPath)) {
							continue
						}

						if (dirent.isFile()) {
							// Minimal include filtering if provided
							if (params.include && !fullPath.includes(params.include.replace("*", ""))) {
								continue
							}
							filePathsToRead.push(fullPath)
						}
					}
				} catch (e) {
					Logger.warn(`Failed to read dir ${folderPath}: ${e}`)
				}
			}

			const uniquePaths = Array.from(new Set(filePathsToRead))

			if (uniquePaths.length === 0) {
				return { llmContent: "No files found.", returnDisplay: "No files found.", data: [] }
			}

			let outputText = ""
			const data = []
			let successCount = 0
			const MAX_FILES = 50
			const filesToProcess = uniquePaths.slice(0, MAX_FILES)

			const readResults = await mapAsync(filesToProcess, 5, async (filePath) => {
				try {
					const stat = await fs.stat(filePath)
					if (stat.size > maxFileSizeBytes) {
						return {
							filePath,
							skipped: true,
							reason: `File size ${stat.size} bytes exceeds limit of ${maxFileSizeMB}MB`,
							content: "",
						}
					}

					const contentRaw = await fs.readFile(filePath)
					
					// Binary Protection: Check for binary data before decoding
					if (isBinary(contentRaw)) {
						return {
							filePath,
							skipped: true,
							reason: "Binary file detected (reading binary files is not supported)",
							content: "",
						}
					}

					const content = new TextDecoder("utf-8", { fatal: false }).decode(contentRaw)
					return { filePath, skipped: false, content }
				} catch (e) {
					Logger.warn(`Failed to read ${filePath}`)
					return { filePath, error: e }
				}
			})

			for (const res of readResults) {
				if (!res) {
					continue
				}
				const { filePath, skipped, reason, content, error } = res
				const relPath = makeRelative(filePath as string, this.workspaceRoot)

				if (error) {
					continue
				}

				if (skipped) {
					outputText += `\n--- ${relPath} ---\n[Skipped: ${reason}]\n`
					continue
				}

				if (outputText.length >= MAX_TOTAL_SIZE) {
					outputText += `\n[Stopped: Total output size limit of 350KB reached. Remaining files skipped.]\n`
					break
				}

				const allLines = (content || "").split("\n")
				const start = params.offset || 0
				let end = allLines.length
				let isTruncated = false

				if (params.limit) {
					end = Math.min(allLines.length, start + params.limit)
					isTruncated = allLines.length > end
				} else if (start > 0) {
					// Apply offset even if limit is not set
					end = allLines.length
				}

				// Ensure start is within bounds
				const safeStart = Math.min(start, allLines.length)
				const safeEnd = Math.max(safeStart, end)

				const linesSlice = allLines.slice(safeStart, safeEnd)

				// Generate content with line numbers for LLM/Display
				const numberedContent = linesSlice.map((line, idx) => `${safeStart + idx + 1} | ${line}`).join("\n")

				// Keep raw content for data
				const rawContent = linesSlice.join("\n")

				const stat = await fs.stat(filePath)
				const fileHash = (Math.floor(stat.mtimeMs).toString(36) + stat.size.toString(36)).toUpperCase()

				const header = `\n--- ${relPath}[${fileHash}] ---\n`
				const footer = isTruncated ? `\n...(truncated via limit)...\n` : `\n`
				const projectedSize = outputText.length + header.length + numberedContent.length + footer.length

				if (projectedSize > MAX_TOTAL_SIZE) {
					const availableSpace = MAX_TOTAL_SIZE - outputText.length - header.length - 100
					if (availableSpace > 0) {
						outputText += header
						outputText += numberedContent.substring(0, availableSpace)
						outputText += `\n... [Truncated: Total output size limit of 350KB reached] ...\n`
						data.push({ path: relPath, content: rawContent })
						successCount++
					} else {
						outputText += `\n[Stopped: Total output size limit of 350KB reached]\n`
					}
					break
				}

				outputText += header + numberedContent + footer
				data.push({ path: relPath, content: rawContent })
				successCount++
			}

			if (uniquePaths.length > MAX_FILES) {
				outputText += `\n\n[Warning] Matched ${uniquePaths.length} files, processed first ${MAX_FILES} (or until size limit).`
			}

			return {
				llmContent: outputText.trim(),
				returnDisplay: `Read ${successCount} file(s) (Limit: 350KB).`,
				data: data,
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			return { llmContent: `Error: ${msg}`, returnDisplay: "Error", error: { message: msg } }
		}
	}
}
