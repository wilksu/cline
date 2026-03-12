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
		const formatted = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message
		HostProvider.get().logToChannel(`[${timestamp()}] [INFO] ${formatted}`)
	},

	warn(message: string, ...args: unknown[]): void {
		const formatted = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message
		HostProvider.get().logToChannel(`[${timestamp()}] [WARN] ${formatted}`)
	},

	error(message: string, error?: unknown): void {
		const errorStr = error instanceof Error ? error.message : error ? String(error) : ""
		HostProvider.get().logToChannel(`[${timestamp()}] [ERROR] ${message} ${errorStr}`)
	},

	debug(message: string, ...args: unknown[]): void {
		const formatted = args.length > 0 ? `${message} ${JSON.stringify(args)}` : message
		HostProvider.get().logToChannel(`[${timestamp()}] [DEBUG] ${formatted}`)
	},

	show(): void {
		// HostProvider doesn't directly expose show() for the channel in a platform-agnostic way
		// if needed, but we can log that it's requested or ignore.
	},

	dispose(): void {
		// Managed by HostProvider
	},
}
