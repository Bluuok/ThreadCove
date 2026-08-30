# ThreadCove

面向个人深度研究的信息分析工作台：将多源信息、独立任务、Agent 后端与统一事件流整合到一个可持续迭代的桌面/Web 环境中。

> 个人项目 · 工程实践风格——类型严格、测试护住核心机制、CI 常驻。**不是**企业级系统：没有数据库/RBAC/监控/容灾。

## 功能总览

| 能力 | 桌面端 (Electron) | WebUI |
| --- | --- | --- |
| Claude / Pi 双后端流式对话 | ✅ | ✅（经同一 WS 服务） |
| Session/Workspace 文件隔离与持久化 | ✅ | ✅ |
| Source→Credential→Tool 统一接入 | ✅ | ✅ |
| 原生文件对话框 / 系统调用 | ✅ | 降级为 Web 等价物（input[type=file] / window.open） |

WebUI 的定位是「验证同一套会话/文件/模型逻辑能否复用」的第二个载体——传输层只写一遍（`apps/webui/src/adapter/web-api.ts` 仅覆写 LOCAL_ONLY 方法）。

## 架构

```text
研究任务 = Session（会话上下文 + 工具上下文 + 独立工作目录）
└── Workspace（rootPath：偏好默认值 / sources / skills / sessions 存储）
    └── AgentBackend（anthropic=进程内 SDK ／ pi=进程外 JSONL 子进程）—— 产出原生事件
        └── AgentEvent 统一词表 × 双后端适配 × EventQueue 桥 × typed_error 恢复
            └── Session/Workspace 隔离 · Source→Tool 能力接入 —— 与事件层在运行时汇合
                └── 传输层 CHANNEL_MAP + WsRpc + 路由穷举 把一切送到多端 UI
```

### 包结构

```text
packages/
├── core/              纯类型层：AgentEvent / Message / Session / Workspace + 路径可移植工具
├── shared/            协议 / agent / sources / sessions / workspaces / credentials / skills / config
│   └── protocol/      channels · dto · events · routing（穷举测试） · types · codec
└── pi-agent-server/   Pi 子进程入口：stdin/stdout JSONL 循环
apps/
├── electron/          主进程（内嵌 WS server + handlers + SessionManager）、transport、preload、renderer
└── webui/             复用同一 transport + CHANNEL_MAP，只覆写 LOCAL_ONLY 方法
```

### 数据流

```text
UI 调用：renderer.window.api.*（buildClientApi 代理）
        → RoutedClient（LOCAL_ONLY→本地 WsRpcClient；REMOTE_ELIGIBLE→workspaceClient）
        → WS envelope(codec) → WsRpcServer.handle(channel) → handlers → SessionManager
执行：  SessionManager → AgentBackend.chat()
        ├─ anthropic：进程内 SDK query() 流式事件
        └─ pi：spawn 子进程 → JSONL init/prompt → event 行 → EventQueue → 同一 AsyncGenerator 面
        → AgentEvent 统一事件流 → push('session:event') → 所有客户端
能力：  Source 激活 → SourceServerBuilder(+credential vault) → McpClientPool 代理工具
        （mcp__{slug}__{tool}）→ 后端调用经 pool（宿主）或 tool_execute_request（Pi 子进程反向代理回宿主）
```

## 快速开始

```bash
bun install          # Bun ≥ 1.3
bun run typecheck    # 全仓 strict tsc
bun run lint
bun test

# 桌面端（开发）
bun run dev:electron

# WebUI 连 headless 服务（演示「同一套逻辑服务两种载体」）
bun run server:headless 8787
bun run dev:webui    # 打开 http://localhost:5173
```

Claude 后端需要 `ANTHROPIC_API_KEY`。Pi 后端通过 `packages/pi-agent-server` 子进程接入。

## 关键设计

- **R03 模型解耦**：`AgentBackend` 统一 `chat()` 接口；`DRIVER_REGISTRY` 按 provider 路由。
  换后端 = 换 `BackendConfig.provider`（配置层改动）。`redirect()` 双分支：有原生 steering
  的后端注入当前流返回 true，没有的内部 forceAbort 返回 false 由会话层重发——统一接口不假装所有后端一样。
- **R10 事件契约**：`AgentEvent` 可辨识联合（文本增量/工具/权限/结构化错误/完成 + 辅助型），
  事件带 `turnId`（一轮归组）与可选 `parentToolUseId`（工具树）。`EventQueue` 把 Pi 子进程的
  异步回调桥接成与 Claude 相同的 AsyncGenerator 面。`typed_error` 提供 code/title/details/
  actions/canRetry —— 错误恢复由消费侧（UI/会话层）决策，协议只提供信息基础与统一恢复入口。
- **R08 任务隔离**：一个研究任务一个 Session（独立目录 + workingDirectory 默认指向会话目录），
  并行任务的搜索结果/下载/中间产物物理分家。`session.jsonl` 写入后绝对路径替换为
  `{{SESSION_PATH}}` token，会话文件夹移动/换机不烂。持久化队列串行化写 + 原子落盘 +
  header 元数据签名保护外部编辑。
- **R18 能力接入**：Source 三型目录制（mcp/api/local）→ `SourceServerBuilder`（stdio/http/sse，
  三层 header 优先级：配置静态头 < 凭据库多头凭据 < Authorization bearer）→ AES-256-GCM
  机器绑定凭据库 → `McpClientPool` 代理工具（官方 SDK Client，**只到统一转换层**，
  不自研 JSON-RPC/握手）。Skill(SKILL.md) 与 Source 分离：连接/凭据 vs 使用逻辑。
- **R12 统一传输**：每条 RPC 通道必须归 `LOCAL_ONLY_CHANNELS` 或 `REMOTE_ELIGIBLE_CHANNELS`
  恰好其一——routing 穷举测试强制新通道先分类，否则 CI 红。`buildClientApi` 按 `CHANNEL_MAP`
  运行时生成前端 API。preload 只有引导面；非 localhost 明文 `ws://` 直接抛错。

## 文档

- [docs/REPRODUCTION_SPEC.md](docs/REPRODUCTION_SPEC.md) — 复现规格（范围/深度/边界）
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — envelope 格式 + 通道分类表
- [docs/SECURITY.md](docs/SECURITY.md) — 凭据加密模型 + ws:// 明文拒绝 + preload 无 IPC 面

## License

MIT
