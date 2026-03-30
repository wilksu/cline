/**
 * WsBridge Logger
 * Logging utility for the ws-bridge module
 */

import { HostProvider } from "@/hosts/host-provider"

function timestamp(): string {
	return new Date().toISOString().slice(11, 23)
}

export const Logger = {
	info(message: string, ...args: unknown[]): void {
		const formatted = args.length > 0 ? `${message} ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ")}` : message
		HostProvider.get().logToChannel(`[${timestamp()}] [INFO] ℹ️ ${formatted}`)
	},

	warn(message: string, ...args: unknown[]): void {
		const formatted = args.length > 0 ? `${message} ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ")}` : message
		HostProvider.get().logToChannel(`[${timestamp()}] [WARN] ⚠️ ${formatted}`)
	},

	error(message: string, error?: unknown): void {
		let errorDetails = ""
		if (error instanceof Error) {
			errorDetails = `\nStack: ${error.stack}`
		} else if (error) {
			errorDetails = ` ${JSON.stringify(error)}`
		}
		HostProvider.get().logToChannel(`[${timestamp()}] [ERROR] ❌ ${message}${errorDetails}`)
	},

	debug(message: string, ...args: unknown[]): void {
		const formatted = args.length > 0 ? `${message} ${args.map((a) => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ")}` : message
		HostProvider.get().logToChannel(`[${timestamp()}] [DEBUG] 🔍 ${formatted}`)
	},

	show(): void {
		// HostProvider doesn't directly expose show() for the channel in a platform-agnostic way
		// if needed, but we can log that it's requested or ignore.
	},

	dispose(): void {
		// Managed by HostProvider
	},
}
