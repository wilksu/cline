import { HostProvider } from "@/hosts/host-provider"
import { BaseTool } from "../BaseTool"
import type { ToolResult } from "../types"
import { getErrorMessage, makeRelative } from "../utils"

export interface ProblemsParams {
	filePath?: string
}

export class ProblemsTool extends BaseTool<ProblemsParams> {
	static readonly Name = "problems"

	constructor(workspaceRoot: string) {
		super(ProblemsTool.Name, "Get VS Code diagnostics (errors/warnings)", workspaceRoot)
	}

	parseCliArgs(args: string[]): ProblemsParams {
		return { filePath: args[0] }
	}

	async execute(params: ProblemsParams): Promise<ToolResult> {
		try {
			const ignoreController = await this.getIgnoreController()

			// 1. 调用 HostBridge 获取按文件分组的诊断信息
			const response = await HostProvider.workspace.getDiagnostics({})
			const fileDiagnostics = response.fileDiagnostics || []

			const MAX_ITEMS = 50
			const MAX_BYTES = 100 * 1024 // 100KB

			let outputLines: string[] = []
			let errorCount = 0
			let warningCount = 0
			let totalBytes = 0
			let isTruncated = false

			// 2. 扁平化数据并进行过滤
			const allProblems: { filePath: string; diag: any }[] = []
			for (const fileGroup of fileDiagnostics) {
				const fsPath = fileGroup.filePath
				if (!fsPath) continue

				// 过滤逻辑：不属于当前工作区或被忽略的文件
				if (!fsPath.startsWith(this.workspaceRoot)) continue
				if (this.isPathIgnored(ignoreController, fsPath)) continue
				if (params.filePath && !fsPath.includes(params.filePath)) continue

				if (fileGroup.diagnostics) {
					for (const d of fileGroup.diagnostics) {
						// 只关注 Error (1) 和 Warning (2)
						if (d.severity === 1 || d.severity === 2) {
							allProblems.push({ filePath: fsPath, diag: d })
						}
					}
				}
			}

			// 3. 排序：错误优先，然后按行号
			allProblems.sort((a, b) => {
				if (a.diag.severity !== b.diag.severity) return (a.diag.severity || 0) - (b.diag.severity || 0)
				return (a.diag.range?.start?.line || 0) - (b.diag.range?.start?.line || 0)
			})

			for (const item of allProblems) {
				const diag = item.diag
				if (outputLines.length >= MAX_ITEMS) {
					isTruncated = true
					break
				}

				const severityLabel = this.getSeverityLabel(diag.severity || 0)
				if (diag.severity === 1) errorCount++
				else if (diag.severity === 2) warningCount++

				const relPath = makeRelative(item.filePath, this.workspaceRoot)
				const line = (diag.range?.start?.line || 0) + 1
				const col = (diag.range?.start?.character || 0) + 1
				const message = (diag.message || "").replace(/\r?\n/g, " ")
				const source = diag.source ? ` [${diag.source}]` : ""
				
				const formatted = `[${severityLabel}] ${relPath}:${line}:${col} - ${message}${source}`
				// 替代 Buffer.byteLength 以兼容环境并消除 TS 报错
				const lineBytes = new TextEncoder().encode(formatted).length + 1

				if (totalBytes + lineBytes > MAX_BYTES) {
					isTruncated = true
					break
				}

				outputLines.push(formatted)
				totalBytes += lineBytes
			}

			let llmContent = outputLines.join("\n") || "No problems detected in the specified scope."
			if (isTruncated) {
				llmContent += `\n\n[NOTICE: Output truncated. Showing first ${outputLines.length} items within ${MAX_BYTES / 1024}KB limit.]`
			}

			const summary = `Found ${errorCount} errors, ${warningCount} warnings.`

			return {
				llmContent,
				returnDisplay: summary,
				data: { errorCount, warningCount, isTruncated }
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			return { llmContent: `Error getting problems: ${msg}`, returnDisplay: "Error", error: { message: msg } }
		}
	}

	private getSeverityLabel(severity: number): string {
		switch (severity) {
			case 1: return "ERROR"
			case 2: return "WARNING"
			case 3: return "INFO"
			case 4: return "HINT"
			default: return "UNKNOWN"
		}
	}
}