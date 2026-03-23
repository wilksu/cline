import * as fs from "fs/promises"
import * as path from "path"
import { ClineIgnoreController } from "@/core/ignore/ClineIgnoreController"
import { BaseTool } from "../BaseTool"
import { Logger } from "../Logger"
import type { ToolResult } from "../types"
import { getErrorMessage, isPathWithinWorkspace, makeRelative } from "../utils"

export interface LSToolParams {
	paths: string[]
	recursive?: boolean
	depth?: number
	include?: string
	ignore?: string[]
	long?: boolean
}

export interface FileEntry {
	name: string
	path: string
	isDirectory: boolean
	size: number
	modifiedTime: number
	children?: FileEntry[]
}

export class LSTool extends BaseTool<LSToolParams> {
	static readonly Name = "ls"

	constructor(workspaceRoot: string) {
		super(LSTool.Name, "List files", workspaceRoot)
	}

	parseCliArgs(args: string[]): LSToolParams {
		const params: LSToolParams = { paths: [], ignore: [] }
		for (let i = 0; i < args.length; i++) {
			const arg = args[i]
			if (arg === "-R" || arg === "--recursive") {
				params.recursive = true
			} else if (arg === "-l" || arg === "--long") {
				params.long = true
			} else if ((arg === "--depth" || arg === "-d") && i + 1 < args.length) {
				params.depth = parseInt(args[++i])
			} else if ((arg === "--include" || arg === "-i") && i + 1 < args.length) {
				params.include = args[++i]
			} else if ((arg === "--ignore" || arg === "-I") && i + 1 < args.length) {
				params.ignore?.push(args[++i])
			} else if (!arg.startsWith("-")) {
				params.paths.push(arg)
			}
		}
		return params
	}

	async execute(params: LSToolParams): Promise<ToolResult> {
		try {
			const targetPaths = params.paths.length > 0 ? params.paths : ["."]
			const allEntries: FileEntry[] = []
			const lines: string[] = []
			let totalCount = 0

			// Use native ClineIgnoreController
			const ignoreController = await this.getIgnoreController()

			// 递归深度逻辑：默认 5 层，允许参数覆盖，硬上限 15 层
			let maxDepth = 0
			if (params.recursive) {
				maxDepth = params.depth !== undefined ? Math.min(params.depth, 15) : 5
			}

			for (let i = 0; i < targetPaths.length; i++) {
				let p = targetPaths[i]
				if (!path.isAbsolute(p)) {
					p = path.join(this.workspaceRoot, p)
				}

				if (!isPathWithinWorkspace(p, this.workspaceRoot)) {
					lines.push(`Error: Access denied: ${p}`)
					continue
				}

				if (targetPaths.length > 1) {
					if (i > 0) lines.push("")
					lines.push(`${makeRelative(p, this.workspaceRoot)}:`)
				}

				const entries = await this.walk(p, 0, maxDepth, params.include, params.ignore, ignoreController, params.long)
				this.renderTree(entries, lines, 0, params.long)

				allEntries.push(...entries)
				totalCount += this.countFiles(entries)
			}

			const summary = `Listed ${totalCount} items from ${targetPaths.length} path(s)${params.include ? ` (filtering: ${params.include})` : ""}`

			return {
				llmContent: lines.length > 0 ? lines.join("\n") : "No files found.",
				returnDisplay: summary,
				data: allEntries,
			}
		} catch (e) {
			const msg = getErrorMessage(e)
			return { llmContent: msg, returnDisplay: "Error", error: { message: msg } }
		}
	}

	private async walk(
		dirPath: string,
		currentDepth: number,
		maxDepth: number,
		include?: string,
		manualIgnores?: string[],
		ignoreController?: ClineIgnoreController,
		fetchDetails = false,
	): Promise<FileEntry[]> {
		try {
			const stat = await fs.stat(dirPath)

			if (stat.isFile()) {
				const name = path.basename(dirPath)
				return [{ name, path: dirPath, isDirectory: false, size: stat.size, modifiedTime: stat.mtimeMs }]
			}

			const children = await fs.readdir(dirPath, { withFileTypes: true })

			// 编译过滤器
			const includeRegex = include
				? new RegExp(include.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*"))
				: null

			const entryPromises = children.map(async (dirent) => {
				const name = dirent.name
				// 基础过滤
				if (name.startsWith(".") && name !== ".gitignore" && name !== ".cline-rules") {
					if (name !== ".cursorrules" && name !== ".windsurfrules") return null
				}

				const fullPath = path.join(dirPath, name)
				const isDir = dirent.isDirectory()

				// Manual exclude flag (e.g. --ignore "test")
				if (manualIgnores && manualIgnores.some((pattern) => fullPath.includes(pattern.replace("*", "")))) {
					return null
				}

				// Native .clineignore check
				if (ignoreController && this.isPathIgnored(ignoreController, fullPath)) {
					return null
				}

				// 文件包含过滤
				if (!isDir && includeRegex && !includeRegex.test(name)) {
					return null
				}

				let size = 0
				let mtime = 0

				// 仅在显式要求长格式且是文件时获取详情，减少 IPC 开销
				if (fetchDetails && !isDir) {
					try {
						const s = await fs.stat(fullPath)
						size = s.size
						mtime = s.mtimeMs
					} catch {
						// 忽略 stat 错误
					}
				}

				const entry: FileEntry = { name, path: fullPath, isDirectory: isDir, size, modifiedTime: mtime }

				if (isDir && currentDepth < maxDepth) {
					entry.children = await this.walk(
						fullPath,
						currentDepth + 1,
						maxDepth,
						include,
						manualIgnores,
						ignoreController,
						fetchDetails,
					)
				}

				return entry
			})

			const results = await Promise.all(entryPromises)
			const entries = results.filter((item): item is FileEntry => item !== null)

			// 排序：目录优先，然后按名称
			return entries.sort((a, b) => {
				if (a.isDirectory !== b.isDirectory) {
					return a.isDirectory ? -1 : 1
				}
				return a.name.localeCompare(b.name)
			})
		} catch (e) {
			Logger.warn(`Failed to walk ${dirPath}: ${getErrorMessage(e)}`)
			return []
		}
	}

	private renderTree(entries: FileEntry[], lines: string[], depth: number, showDetails = false) {
		const indent = "  ".repeat(depth)
		for (const entry of entries) {
			const sizeStr = !entry.isDirectory && showDetails ? ` (${this.formatSize(entry.size)})` : ""
			lines.push(`${indent}${entry.isDirectory ? "[DIR] " : ""}${entry.name}${sizeStr}`)
			if (entry.children) {
				this.renderTree(entry.children, lines, depth + 1, showDetails)
			}
		}
	}

	private formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
	}

	private countFiles(entries: FileEntry[]): number {
		let count = 0
		for (const entry of entries) {
			count++
			if (entry.children) {
				count += this.countFiles(entry.children)
			}
		}
		return count
	}
}
