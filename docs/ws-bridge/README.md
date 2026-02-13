# WebSocket Bridge (ws-bridge)

This module enables browser-based AI interaction with Cline through a WebSocket server.

## Overview

The WebSocket Bridge allows a browser-side AI (like Gemini with a Tampermonkey script) to send commands to Cline for execution. Cline acts as a pure execution engine without involving its own LLM.

## Features

- **File Operations**: `ls:`, `read:`, `search:`, `action:`, `edit:`
- **Command Execution**: `run:` (coming soon - will use Cline's terminal)
- **Browser Automation**: `browser:` (coming soon - will use Cline's browser session)
- **MCP Tools**: `mcp:` (coming soon - will use Cline's MCP integration)

## Configuration

In VS Code settings:

```json
{
  "cline.wsBridge.enabled": true,
  "cline.wsBridge.port": 3456,
  "cline.wsBridge.autoStart": true
}
```

## Usage

### Starting the Server

1. Open Command Palette (Ctrl+Shift+P)
2. Run "Cline: Start WebSocket Bridge"

Or enable auto-start in settings.

### Browser Integration

Use the Tampermonkey script in `monkey.txt` to connect Gemini web chat to Cline.

1. Install Tampermonkey browser extension
2. Create new script and paste contents of `monkey.txt`
3. Navigate to Gemini chat
4. Use the floating control panel to connect

### AI Prompt

Copy the contents of `prompt.md` to your AI's system instructions to enable the command protocol.

## Command Format

```
ls: src/
read: src/index.ts
search: "function" src/
action: path/to/file.ts
```code```
edit: path/to/file.ts
<<<<<<< SEARCH
old content
=======
new content
>>>>>>> REPLACE
```

## Architecture

```
Browser (Gemini + Tampermonkey)
         │
         │ WebSocket ws://localhost:3456
         ▼
   WsBridgeServer
         │
         ▼
   CommandParser
         │
         ▼
   ToolExecutor
         │
    ┌────┴────┐
    ▼         ▼
 LSTool    ReadTool  ...
```


### 1. 单个 `edit` 指令内（安全区域 ✅）

* **原子性**：是。
* **机制**：我在 `FileEditor.ts` 里写的逻辑是先读取文件，一次性解析该指令块中包含的所有 `<<<<<<< LINES` 块，**先在内存中按倒序计算并应用**，最后一次性写入磁盘。
* **结果**：只要在一个 `edit` 指令里写多少个块都是安全的，互不影响。

### 2. 多个 `edit` 指令间（危险区域 ⚠️）

* **原子性**：否。它们是**顺序执行**（Sequential Execution）的。
* **机制**：`ToolExecutor` 会先执行第一个 `edit`，**写入磁盘**。然后执行第二个 `edit`，重新从磁盘读取文件。
* **灾难场景**：
1. 你发了两个 `edit` 指令修改同一个文件。
2. 第一个指令把第 10-20 行删除了（文件缩短了 10 行）。
3. 第二个指令想修改第 80-90 行。
4. **实际发生**：当轮到第二个指令执行时，它读取的是已经被修改过的文件。原来的“第 80 行”现在变成了“第 70 行”。
5. **后果**：它会错误地修改当前的第 80-90 行（实际上是原来的 90-100 行），导致**代码改坏（Logic Corruption）**，或者如果范围超出文件长度则报错。



---

### 最佳实践总结

为了安全高效地使用我刚开发的这套系统，请遵守以下原则：

#### ✅ 推荐做法：合并块 (Merge Blocks)

将针对**同一个文件**的所有修改，合并在**同一个** `edit` 指令中：

```typescript
edit: "src/main.ts"
<<<<<<< LINES: 10-15
// 修改 A
>>>>>>>
<<<<<<< LINES: 80-90
// 修改 B
>>>>>>>

```

* **系统行为**：读取一次文件 -> 内存中倒序应用 A 和 B -> 写入一次文件。**完美安全。**

#### ❌ 错误做法：拆分指令 (Split Commands)

不要在同一轮对话中对同一个文件发多条 `edit` 指令（尤其是基于行号时）：

```typescript
// 危险！不要这样做！
edit: "src/main.ts"
<<<<<<< LINES: 10-15
...
>>>>>>>

edit: "src/main.ts" 
<<<<<<< LINES: 80-90
...
>>>>>>>

```

* **系统行为**：
1. 应用修改 A -> 保存（行号变了）。
2. 读取文件 -> 试图在旧行号位置应用修改 B -> **位置偏移，修改错误的代码**。



### 结论

**同一个文件的所有修改，必须打包在同一个 `edit` 指令中发送。** 不同文件的 `edit` 指令可以随意混排，互不影响。