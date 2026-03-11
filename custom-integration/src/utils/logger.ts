import * as vscode from "vscode";

// biome-ignore all: Output channel creation is required for logging
const outputChannel = vscode.window.createOutputChannel("Cline Ws-Bridge");

export const Logger = {
    info(message: string, ...args: any[]) {
        outputChannel.appendLine(`[INFO] ${message} ${args.length ? JSON.stringify(args) : ""}`);
    },
    error(message: string, error?: any) {
        outputChannel.appendLine(`[ERROR] ${message} ${error ? error.message || error : ""}`);
    },
    debug(message: string) {
        outputChannel.appendLine(`[DEBUG] ${message}`);
    }
};
