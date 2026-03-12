/**
 * FileEditor - File write, edit, and delete operations
 * Migrated from ws-agent
 */

import * as fs from "fs/promises"
import * as path from "path"

export class FileEditor {
	constructor(private readonly workspaceRoot: string) {}

	/**
	 * Apply partial edit using Search & Replace blocks or Line Number blocks
	 */
	private async getFileHash(targetPath: string): Promise<string> {
		try {
			const stat = await fs.stat(targetPath)
			// Creates a pure alphanumeric hash like: 18FA3B2A9C
			return (Math.floor(stat.mtimeMs).toString(36) + stat.size.toString(36)).toUpperCase()
		} catch {
			return "NONE"
		}
	}

	/**
	 * Apply partial edit using Search & Replace blocks or Line Number blocks
	 */
	async applyEdit(relativePath: string, codeBlock: string, expectedHash?: string): Promise<string> {
		const targetPath = path.join(this.workspaceRoot, relativePath)

		let originalContent: string
		try {
			const currentHash = await this.getFileHash(targetPath)
			if (expectedHash && expectedHash !== currentHash) {
				throw new Error(
					`Hash mismatch (Dirty Write)! Expected: [${expectedHash}], Current: [${currentHash}]. The file was modified. Please read the file again before editing.`,
				)
			}
			originalContent = await fs.readFile(targetPath, "utf8")
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("Hash mismatch")) throw e
			throw new Error(`Cannot edit non-existent file: ${relativePath}`)
		}

		const normalize = (str: string) => str.replace(/\r\n/g, "\n")
		let currentContent = normalize(originalContent)

		// 1. Check for line-based edits first
		const lineBlockRegex = /<<<<<<< LINES:\s*(\d+)-(\d+)\s*([\s\S]*?)>>>>>>>/g
		let lineMatch
		let lineEditsApplied = 0

		const lineEdits: { start: number; end: number; content: string }[] = []
		while ((lineMatch = lineBlockRegex.exec(codeBlock)) !== null) {
			lineEdits.push({
				start: parseInt(lineMatch[1]),
				end: parseInt(lineMatch[2]),
				content: lineMatch[3],
			})
		}

		if (lineEdits.length > 0) {
			// Sort descending to keep line numbers valid during replacement
			lineEdits.sort((a, b) => b.start - a.start)
			const lines = currentContent.split("\n")

			for (const edit of lineEdits) {
				// Validate bounds
				if (edit.start < 1 || edit.end > lines.length || edit.start > edit.end) {
					throw new Error(`Invalid line range: ${edit.start}-${edit.end} (File has ${lines.length} lines)`)
				}

				// Adjust for 0-based index
				const startIdx = edit.start - 1
				const count = edit.end - edit.start + 1

				// Normalize replacement content
				const newLines = normalize(edit.content).split("\n")
				// Remove trailing newline from split if it's just an empty string at the end
				if (newLines.length > 0 && newLines[newLines.length - 1] === "") {
					newLines.pop()
				}

				lines.splice(startIdx, count, ...newLines)
				lineEditsApplied++
			}

			currentContent = lines.join("\n")
		}

		// 2. SEARCH/REPLACE blocks (Fallback or Mixed)
		const blockRegex = /<<<<<<< SEARCH\s*([\s\S]*?)\s*=======\s*([\s\S]*?)\s*>>>>>>> REPLACE/g
		let match
		let searchEditsApplied = 0

		while ((match = blockRegex.exec(codeBlock)) !== null) {
			searchEditsApplied++
			const searchBlock = match[1]
			const replaceBlock = match[2]

			const normSearch = normalize(searchBlock).trim()
			const normReplace = normalize(replaceBlock).trim()

			if (!currentContent.includes(normSearch)) {
				// If we already applied line edits, this might be intentional overlap, but usually it's an error
				throw new Error(
					`Edit failed: Could not find SEARCH block #${searchEditsApplied} in ${relativePath}. Context mismatch.`,
				)
			}

			currentContent = currentContent.replace(normSearch, () => normReplace)
		}

		if (lineEditsApplied === 0 && searchEditsApplied === 0) {
			throw new Error(
				"Invalid edit block format. Expected:\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE\n\nOR\n\n<<<<<<< LINES: start-end\n...\n>>>>>>>",
			)
		}

		await fs.writeFile(targetPath, currentContent, "utf8")

		return this.generateSuccessResponse(`Edited ${relativePath}`, targetPath, relativePath)
	}

	/**
	 * Full file write (for action: write)
	 */
	async writeFile(relativePath: string, content: string, expectedHash?: string): Promise<string> {
		const targetPath = path.join(this.workspaceRoot, relativePath)

		let actionType = "Updated"
		try {
			const currentHash = await this.getFileHash(targetPath)
			if (expectedHash && expectedHash !== currentHash) {
				throw new Error(`Hash mismatch (Dirty Write)! Expected: [${expectedHash}], Current: [${currentHash}].`)
			}
		} catch (e: unknown) {
			if (e instanceof Error && e.message.includes("Hash mismatch")) throw e
			actionType = "Created"
		}

		// Ensure directory exists
		await fs.mkdir(path.dirname(targetPath), { recursive: true })
		await fs.writeFile(targetPath, content, "utf8")
		return this.generateSuccessResponse(`${actionType} ${relativePath}`, targetPath, relativePath)
	}

	/**
	 * Generate detailed response to return to LLM after successful edit
	 */
	private async generateSuccessResponse(actionMessage: string, targetPath: string, relativePath: string): Promise<string> {
		try {
			const newHash = await this.getFileHash(targetPath)
			return `[SUCCESS] ${actionMessage}\nNew Hash Reference: ${relativePath}[${newHash}]`
		} catch (e) {
			return `[SUCCESS] ${actionMessage}\n(Warning: Failed to generate new hash)`
		}
	}

	/**
	 * Delete file
	 */
	async deleteFile(relativePath: string): Promise<string> {
		const targetPath = path.join(this.workspaceRoot, relativePath)
		await fs.unlink(targetPath)
		return `Deleted ${relativePath}`
	}
}
