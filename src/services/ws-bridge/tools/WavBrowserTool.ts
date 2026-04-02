import * as vscode from "vscode"
import { connect, Browser, Page, BrowserContext } from "puppeteer-core"
import { BaseTool } from "../BaseTool"
import type { ToolResult } from "../types"
import { Logger } from "../Logger"

export interface WavBrowserParams {
	action: "launch" | "close" | "navigate" | "evaluate" | "sniff_results"
	url?: string
	code?: string
}

// 静态单例管理，确保跨指令的会话持久性
let globalBrowser: Browser | null = null
let currentContext: BrowserContext | null = null
let currentPage: Page | null = null
let interceptedRequests: any[] = []

export class WavBrowserTool extends BaseTool<WavBrowserParams> {
	static readonly Name = "wav_browser"

	constructor(workspaceRoot: string) {
		super(WavBrowserTool.Name, "High-performance Web Analysis Browser", workspaceRoot)
	}

	parseCliArgs(args: string[]): WavBrowserParams {
		if (args.length === 0) throw new Error("WavBrowser requires an action (launch|close|navigate|evaluate|sniff_results)")
		const action = args[0] as WavBrowserParams["action"]
		const params: WavBrowserParams = { action }
		
		if (action === "navigate") params.url = args[1]
		if (action === "evaluate") params.code = args.slice(1).join(" ")
		
		return params
	}

	private async getConfiguration() {
		const config = vscode.workspace.getConfiguration("cline.wsBridge")
		return {
			wsEndpoint: config.get<string>("wavBrowserWs") || "ws://localhost:3000",
			autoSniff: config.get<boolean>("wavBrowserSniff") ?? true
		}
	}

	async execute(params: WavBrowserParams): Promise<ToolResult> {
		const config = await this.getConfiguration()

		try {
			switch (params.action) {
				case "launch":
					// 1. 确保 Browser 连接存在
					if (!globalBrowser || !globalBrowser.connected) {
						Logger.info(`Connecting to Browserless at ${config.wsEndpoint}`)
						globalBrowser = await connect({ 
							browserWSEndpoint: config.wsEndpoint,
							defaultViewport: { width: 1280, height: 800 }
						})
					}

					// 2. 隔离：销毁旧上下文并创建新匿名上下文
					if (currentContext) await currentContext.close().catch(() => {})
					currentContext = await globalBrowser.createBrowserContext()
					currentPage = await currentContext.newPage()
					
					// 3. 配置嗅探
					interceptedRequests = []
					if (config.autoSniff) {
						currentPage.on("response", (response) => {
							const req = response.request()
							const resType = req.resourceType()
							if (["fetch", "xhr"].includes(resType)) {
								interceptedRequests.push({
									ts: new Date().toISOString(),
									url: req.url(),
									method: req.method(),
									status: response.status(),
									type: resType
								})
							}
						})
					}
					return { 
						llmContent: `WavBrowser launched. [Endpoint: ${config.wsEndpoint}] [Sniffing: ${config.autoSniff}]`, 
						returnDisplay: "Browser Ready" 
					}

				case "navigate":
					if (!currentPage || !params.url) throw new Error("WavBrowser: No active page or URL missing.")
					await currentPage.goto(params.url, { 
						waitUntil: "networkidle2", 
						timeout: 30000 
					})
					return { 
						llmContent: `Successfully navigated to: ${params.url}`, 
						returnDisplay: "Navigation Success" 
					}

				case "evaluate":
					if (!currentPage || !params.code) throw new Error("WavBrowser: No active page or script missing.")
					// 增加超时保护，防止恶意脚本挂死
					const evalResult = await Promise.race([
						currentPage.evaluate(params.code),
						new Promise((_, reject) => setTimeout(() => reject(new Error("Script evaluation timeout (10s)")), 10000))
					])
					return { 
						llmContent: `Script execution result:\n${JSON.stringify(evalResult, null, 2)}`,
						data: evalResult,
						returnDisplay: "Eval Complete" 
					}

				case "sniff_results":
					return {
						llmContent: interceptedRequests.length > 0 
							? `Captured ${interceptedRequests.length} API requests:\n${JSON.stringify(interceptedRequests.slice(-20), null, 2)}`
							: "No API requests captured yet.",
						data: interceptedRequests,
						returnDisplay: `Sniffed ${interceptedRequests.length} items`
					}

				case "close":
					if (currentContext) {
						await currentContext.close()
						currentContext = null
						currentPage = null
						interceptedRequests = []
					}
					return { llmContent: "WavBrowser context destroyed and memory cleared.", returnDisplay: "Cleaned" }

				default:
					throw new Error(`Unsupported WavBrowser action: ${params.action}`)
			}
		} catch (error: any) {
			Logger.error(`WavBrowser [${params.action}] failed`, error)
			return { 
				llmContent: `WavBrowser Error: ${error.message}`, 
				error: { message: error.message },
				returnDisplay: "Execution Failed"
			}
		}
	}
}