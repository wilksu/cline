/**
 * WsBridge Types
 * WebSocket Bridge for browser automation integration
 */

// --- Command Types ---

export type CommandType =
	| "ls"
	| "list"
	| "dir"
	| "read"
	| "cat"
	| "read_file"
	| "search"
	| "grep"
	| "find"
	| "action"
	| "edit"
	| "run"
	| "exec"
	| "cmd"
	| "browser"
	| "mcp"
	| "symbol"

export interface ParsedCommand {
	type: "action" | "tool"
	name: string
	args?: string[]
	actionPayload?: ActionPayload
	outputJson?: boolean
}

export interface ActionPayload {
	path: string
	isEdit: boolean
	content?: string
	expectedHash?: string
}

// --- Execution Results ---

export interface ExecutionResult {
	command: string
	status: "success" | "error" | "pending_approval"
	output: string
	data?: unknown
}

// --- WebSocket Messages ---

export interface WsRequest {
	id: string
	command: string
}

export interface WsResponse {
	id: string
	status: "completed" | "pending_approval" | "error"
	output?: string
	error?: string
}

// --- Tool Result ---

export interface ToolResult {
	llmContent: string
	returnDisplay?: string
	data?: unknown
	error?: { message: string }
}

// --- Bridge Configuration ---

export interface WsBridgeConfig {
	port: number
	autoStart: boolean
	enabled: boolean
}
