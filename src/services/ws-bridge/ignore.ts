import * as fs from "fs/promises"
import * as path from "path"
import { ClineIgnoreController } from "@/core/ignore/ClineIgnoreController"
import { Logger } from "@/shared/services/Logger"

// Cache controllers per workspace to prevent memory leaks from duplicate file watchers (Chokidar)
const controllers = new Map<string, ClineIgnoreController>()

const DEFAULT_CLINEIGNORE_CONTENT = `# Dependencies
node_modules/
**/node_modules/
.pnp
.pnp.js

# Build outputs
/build/
/dist/
/.next/
/out/

# Testing
/coverage/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Large data files
*.csv
*.xlsx
`

/**
 * Gets or initializes the native ClineIgnoreController for the workspace.
 * Auto-generates a default .clineignore file if one does not exist.
 * This strictly aligns ws-bridge with Cline's native .clineignore behavior.
 */
export async function getWorkspaceIgnoreController(workspaceRoot: string): Promise<ClineIgnoreController> {
	let controller = controllers.get(workspaceRoot)

	if (!controller) {
		const ignorePath = path.join(workspaceRoot, ".clineignore")
		try {
			await fs.access(ignorePath)
		} catch {
			// File does not exist, auto-create it with default content
			try {
				await fs.writeFile(ignorePath, DEFAULT_CLINEIGNORE_CONTENT, "utf8")
			} catch (e) {
				Logger.warn("Error auto-creating .clineignore:", e)
			}
		}

		controller = new ClineIgnoreController(workspaceRoot)
		await controller.initialize()
		controllers.set(workspaceRoot, controller)
	}

	return controller
}

/**
 * Cleanup function to dispose all watchers when ws-bridge is stopped.
 */
export async function disposeIgnoreControllers(): Promise<void> {
	for (const controller of controllers.values()) {
		await controller.dispose()
	}
	controllers.clear()
}
