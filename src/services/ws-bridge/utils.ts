/**
 * WsBridge Utilities
 * Common utility functions for the ws-bridge module
 */

import * as path from "path"
import * as vscode from "vscode"

export function makeRelative(filePath: string, rootPath: string): string {
	return path.relative(rootPath, filePath)
}

export function shortenPath(filePath: string): string {
	const parts = filePath.split(path.sep)
	if (parts.length > 3) {
		return ".../" + parts.slice(-2).join("/")
	}
	return filePath
}

export function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message
	}
	return String(error)
}

export function isPathWithinWorkspace(filePath: string, workspaceRoot: string): boolean {
	const relative = path.relative(workspaceRoot, filePath)
	return !relative.startsWith("..") && !path.isAbsolute(relative)
}

/**
 * Get ws-bridge configuration
 */
export function getWsBridgeConfig<T>(key: string, defaultValue: T): T {
	const config = vscode.workspace.getConfiguration("cline.wsBridge")
	return config.get<T>(key, defaultValue)
}

// File system abstraction layer removed from utils to avoid direct vscode dependency in tools via this utility.
// Use appropriate abstraction layer as per project standards.

/**
 * Chunked async map with concurrency limit
 */
export async function mapAsync<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = []
	for (let i = 0; i < items.length; i += concurrency) {
		const chunk = items.slice(i, i + concurrency)
		const chunkResults = await Promise.all(chunk.map((item, idx) => fn(item, i + idx)))
		results.push(...chunkResults)
	}
	return results
}

/**
 * Generate unique task ID
 */
export function generateTaskId(): string {
	return `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
