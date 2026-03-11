import { Logger } from "../utils/logger";

export interface ParsedCommand {
    type: 'tool' | 'action';
    name: string;
    args: string[];
    actionPayload?: {
        path: string;
        content: string;
        isEdit: boolean;
        expectedHash?: string;
    };
}

export function parseInput(input: string): ParsedCommand[] {
    const commands: ParsedCommand[] = [];
    const lines = input.split(/\r?\n/);
    const fenceRegex = /^```+/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // 处理 write: path[HASH] 或 edit: path[HASH]
        const actionMatch = line.match(/^(write|edit):\s+(.+)$/i);
        if (actionMatch) {
            const isEdit = actionMatch[1].toLowerCase() === 'edit';
            const rawPath = actionMatch[2].trim();
            const hashMatch = rawPath.match(/(.*)\[([a-zA-Z0-9]+)\]$/);
            const filePath = hashMatch ? hashMatch[1] : rawPath;
            const expectedHash = hashMatch ? hashMatch[2] : undefined;

            // 寻找接下来的代码块
            let content = "";
            let foundFence = false;
            for (let j = i + 1; j < lines.length; j++) {
                if (fenceRegex.test(lines[j].trim())) {
                    if (!foundFence) {
                        foundFence = true;
                        continue;
                    } else {
                        // 闭合围栏
                        i = j;
                        break;
                    }
                }
                if (foundFence) content += lines[j] + "\n";
            }

            commands.push({
                type: 'action',
                name: isEdit ? 'edit' : 'write',
                args: [filePath],
                actionPayload: { path: filePath, content: content.trimEnd(), isEdit, expectedHash }
            });
            continue;
        }

        // 处理常规工具指令
        const toolMatch = line.match(/^(\w+):(?:\s+(.*))?$/i);
        if (toolMatch) {
            const name = toolMatch[1].toLowerCase();
            const argStr = toolMatch[2] || "";
            const args = argStr.split(/\s+/).map(a => a.replace(/\[[a-zA-Z0-9]+\]$/, ""));
            commands.push({ type: 'tool', name, args });
        }
    }
    return commands;
}
