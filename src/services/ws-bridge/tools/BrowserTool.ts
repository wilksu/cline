/**
 * BrowserTool - Browser automation using Puppeteer
 * Reuses src/services/browser/BrowserSession.ts
 */

import { StateManager } from "@/core/storage/StateManager"
import { BrowserSession } from "@/services/browser/BrowserSession"
import { BaseTool } from "../BaseTool"
import type { ToolResult } from "../types"
import { getErrorMessage } from "../utils"

export interface BrowserParams {
	action: "launch" | "close" | "click" | "type" | "scroll_down" | "scroll_up" | "navigate"
	url?: string
	coordinate?: string
	text?: string
}

// Singleton to persist session across commands
let globalBrowserSession: BrowserSession | null = null

export class BrowserTool extends BaseTool<BrowserParams> {
	static readonly Name = "browser"

	constructor(workspaceRoot: string) {
		super(BrowserTool.Name, "Browser automation", workspaceRoot)
	}

	parseCliArgs(args: string[]): BrowserParams {
		if (args.length === 0) {
			throw new Error("Usage: browser <action> [args...]")
		}

		const action = args[0] as BrowserParams["action"]
		const params: BrowserParams = { action }

		if (action === "navigate") params.url = args[1]
		else if (action === "click") params.coordinate = args[1]
		else if (action === "type") params.text = args.slice(1).join(" ")

		return params
	}

	private getSession(): BrowserSession {
		if (!globalBrowserSession) {
			globalBrowserSession = new BrowserSession(StateManager.get())
		}
		return globalBrowserSession
	}

	async execute(params: BrowserParams): Promise<ToolResult> {
		const session = this.getSession()

		try {
			let result: any = {}
			let message = ""

			switch (params.action) {
				case "launch":
					await session.launchBrowser()
					message = "Browser launched"
					break
				case "close":
					await session.closeBrowser()
					message = "Browser closed"
					break
				case "navigate":
					if (!params.url) throw new Error("URL required for navigate")
					result = await session.navigateToUrl(params.url)
					message = `Mapsd to ${params.url}`
					break
				case "click":
					if (!params.coordinate) throw new Error("Coordinate required for click (x,y)")
					result = await session.click(params.coordinate)
					message = `Clicked at ${params.coordinate}`
					break
				case "type":
					if (!params.text) throw new Error("Text required for type")
					result = await session.type(params.text)
					message = `Typed text`
					break
				case "scroll_down":
					result = await session.scrollDown()
					message = "Scrolled down"
					break
				case "scroll_up":
					result = await session.scrollUp()
					message = "Scrolled up"
					break
				default:
					throw new Error(`Unknown browser action: ${params.action}`)
			}

			// Format logs and screenshot for LLM
			let llmContent = message
			if (result.logs) {
				llmContent += `\n\nConsole Logs:\n${result.logs}`
			}
			if (result.screenshot) {
				// Don't send full base64 to LLM text context to save tokens,
				// but client could use data field if needed.
				llmContent += `\n\n(Screenshot taken)`
			}

			return {
				llmContent,
				returnDisplay: message,
				data: result,
			}
		} catch (error) {
			const msg = getErrorMessage(error)
			return {
				llmContent: `Browser error: ${msg}`,
				returnDisplay: "Browser error",
				error: { message: msg },
			}
		}
	}
}
