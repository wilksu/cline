import * as vscode from "vscode"
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
			// 使用 vscode 命名空间获取诊断信息
			// biome-ignore lint/nursery/noRestrictedImports: This tool specifically bridge VS Code's internal diagnostics to the webview
			const diagnostics = vscode.languages.getDiagnostics()

			const MAX_ITEMS = 50
			const MAX_BYTES = 100 * 1024 // 100KB
			
			let outputLines: string[] = []
			let errorCount = 0
			let warningCount = 0
			let totalBytes = 0
			let isTruncated = false

			// 扁平化所有诊断信息
			const allProblems = diagnostics.flatMap(([uri, diagList]) => {
				const fsPath = uri.fsPath
				// 过滤逻辑：不在工作区、被忽略的文件、或者指定了路径但不匹配
				if (!fsPath.startsWith(this.workspaceRoot)) return []
				if (this.isPathIgnored(ignoreController, fsPath)) return []
				if (params.filePath && !fsPath.includes(params.filePath)) return []

				return diagList.map(d => ({ uri, diag: d }))
			})

			// 排序：错误优先，然后按行号
			allProblems.sort((a, b) => {
				if (a.diag.severity !== b.diag.severity) return a.diag.severity - b.diag.severity
				return a.diag.range.start.line - b.diag.range.start.line
			})

			for (const item of allProblems) {
				if (outputLines.length >= MAX_ITEMS) {
					isTruncated = true
					break
				}

				const severity = this.getSeverityLabel(item.diag.severity)
				if (item.diag.severity === vscode.DiagnosticSeverity.Error) errorCount++
				else if (item.diag.severity === vscode.DiagnosticSeverity.Warning) warningCount++
				else continue // 忽略 Info 和 Hint

				const relPath = makeRelative(item.uri.fsPath, this.workspaceRoot)
				const line = item.diag.range.start.line + 1
				const col = item.diag.range.start.character + 1
				const message = item.diag.message.replace(/\r?\n/g, " ")
				const source = item.diag.source ? ` [${item.diag.source}]` : ""
				
				const formatted = `[${severity}] ${relPath}:${line}:${col} - ${message}${source}`
				const lineBytes = Buffer.byteLength(formatted, 'utf8') + 1

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

	private getSeverityLabel(severity: vscode.DiagnosticSeverity): string {
		switch (severity) {
			case vscode.DiagnosticSeverity.Error: return "ERROR"
			case vscode.DiagnosticSeverity.Warning: return "WARNING"
			case vscode.DiagnosticSeverity.Information: return "INFO"
			case vscode.DiagnosticSeverity.Hint: return "HINT"
			default: return "UNKNOWN"
		}
	}
}