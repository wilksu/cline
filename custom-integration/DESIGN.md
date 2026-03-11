# Cline Ws-Bridge 重构与平滑适配方案

## 1. 核心目标
- **零侵入性**：不直接修改 Cline 核心源码，所有自定义逻辑存放在 `custom-integration/`。
- **平滑升级**：通过 CI 脚本动态注入入口，确保 Cline 版本更新时冲突最小化。
- **能力复用**：重写逻辑，将 `ws-bridge` 从“独立执行者”转变为“原生 API 适配器”。

## 2. 目录结构
- `src/`: 重写后的 TypeScript 代码。
  - `protocol/`: WebSocket 消息解析与协议定义。
  - `adapters/`: 适配层，调用 Cline 的 `HostProvider` 和原生 Tools。
  - `bridge.ts`: Server 生命周期管理与入口。
- `scripts/`: CI 自动化脚本。
  - `apply-patch.ts`: 负责将代码同步到 `src/` 并修改 `extension.ts`。

## 3. 架构设计


### 3.1 最小化注入点
在 `src/extension.ts` 的 `activate` 函数中寻找稳定锚点：
```typescript
// 注入代码示例
(await import("./services/ws-bridge")).bootstrap(context);

```

### 3.2 逻辑重写原则

* **文件操作**：废弃 `node:fs`，改用 `HostProvider.file` 抽象层。
* **指令执行**：不再重新实现 `ls/read/search`，通过调用原生 Tool 类或转发至 Controller。
* **状态共享**：直接引用 Cline 的单例（如 `WebviewProvider`），共享 `ignore` 规则和工作区状态。

## 4. CI 流程 (Workflow)

1. **Setup**: 拉取目标版本的 Cline 源码。
2. **Inject**: 运行 `scripts/apply-patch.ts`。
* 复制 `custom-integration/src` 到 `src/services/ws-bridge`。
* 修改 `src/extension.ts` 插入 bootstrap 调用。
* 合并 `package.json` 中的自定义依赖。


3. **Build**: 运行原生的 `npm run build`。