<p align="center">
  <h1 align="center">ThreadCove</h1>
  <p align="center">面向个人深度研究的 AI 信息分析工作台</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-%E2%89%A51.3-f9f1e1?logo=bun" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white" alt="TypeScript strict" />
  <img src="https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Electron-39-47848f?logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/tests-135%20passing-brightgreen" alt="tests" />
</p>

---

ThreadCove 把复杂研究问题拆成多个**并行任务**（搜索 → 阅读 → 分析 → 汇总），每个任务一个独立 Session 与工作区；按任务阶段选模型（抓取整理求快省、分析综合求强推理）；外部能力（搜索 API / 网页抓取 / 本地文档 / MCP 工具）统一接入。Electron 桌面端是主力工作台，WebUI 是同一套逻辑的第二个载体——**传输层只写一遍**。

> 个人项目 · 工程实践风格：类型严格、测试护住核心机制、CI 常驻、提交历史干净。不是企业级系统——没有数据库/RBAC/监控/容灾。

## ✨ 核心能力

| | 能力 | 说明 |
|---|---|---|
| 🔌 | **模型后端解耦** | `AgentBackend` 统一 `chat()` 接口，DeepSeek / Claude / Pi 三后端可换，切换 = 改一行配置 |
| 🗂 | **任务隔离** | 一个研究任务一个 Session + 独立工作目录，并行任务的产物物理分家，互不污染 |
| 🌊 | **统一事件流** | `AgentEvent` 可辨识联合类型——文本增量/工具/权限/结构化错误/完成，双后端出同一种事件，UI 按 type 分流渲染 |
| 🔑 | **统一能力接入** | MCP / API / 本地数据源统一转成 Agent 可调用工具，凭据加密集中管理，调用时自动注入 |
| 🖥 | **多端复用** | 每条 RPC 通道显式分类 LOCAL_ONLY / REMOTE_ELIGIBLE（穷举测试强制），桌面直连与 Web 代理共用一套协议 |

## 🏗 架构

```text
研究任务 = Session（会话上下文 + 工具上下文 + 独立工作目录）
└── Workspace（rootPath：偏好默认值 / sources / skills / sessions 存储）
    └── AgentBackend（deepseek=OpenAI兼容流式 ／ anthropic=进程内 SDK ／ pi=进程外 JSONL 子进程）
        └── AgentEvent 统一词表 × 多后端适配 × EventQueue 桥 × typed_error 恢复
            └── Session/Workspace 隔离 · Source→Credential→Tool 能力接入（运行时汇合）
                └── 传输层 CHANNEL_MAP + WsRpc + 路由穷举 → 多端 UI
```

### 包结构

```text
packages/
├── core/               纯类型层：AgentEvent / Message / Session / Workspace + win32 路径可移植工具
└── shared/
    ├── protocol/       channels · dto · events · routing(穷举测试) · types · codec
    ├── agent/          backend 抽象 / factory / claude / pi / deepseek / EventQueue / 事件适配器
    ├── sessions/       session.jsonl 存储 · 持久化队列 · 路径可移植 · 防穿越
    ├── workspaces/     Workspace CRUD + defaults
    ├── sources/        SourceServerBuilder(三层header优先级) · api-tools · storage
    ├── credentials/    AES-256-GCM 机器绑定加密库
    ├── mcp/            McpClientPool 中央池 + 代理工具命名
    ├── skills/         SKILL.md 加载 + requiredSources 校验
    └── config/         MODEL_REGISTRY(能力字段) · 思考档 · 权限模式
packages/pi-agent-server/   Pi 子进程：stdin/stdout JSONL 协议循环
apps/
├── electron/           主进程(内嵌 WS server + handlers + SessionManager) · transport · preload · React renderer
└── webui/              复用同一 transport + CHANNEL_MAP，只覆写 LOCAL_ONLY 方法
```

### 一条消息的完整旅程

```text
UI 调用 api.sendMessage()
  → buildClientApi 生成的代理 → RoutedClient（REMOTE_ELIGIBLE → WsRpcClient）
  → WS envelope(codec JSON+base64) → WsRpcServer → handlers → SessionManager
  → AgentBackend.chat() 产出 AsyncGenerator<AgentEvent>
      ├─ deepseek：OpenAI 兼容 /chat/completions SSE 流
      ├─ anthropic：Claude Agent SDK query() 流式消息 → 事件适配器
      └─ pi：spawn 子进程 → JSONL init/prompt → 原生事件 → PiEventAdapter → EventQueue 桥
  → 每个事件实时广播 session:event 到所有已连接客户端 + 按 parity 契约落盘 session.jsonl
```

## 🚀 快速开始

**环境要求**：[Bun](https://bun.sh) ≥ 1.3（Windows/macOS/Linux 均可，本仓库在 win32 上开发）

```bash
git clone https://github.com/Bluuok/ThreadCove.git
cd ThreadCove
bun install

# 配置 LLM 密钥（任选其一，写入 .env 或环境变量）
cp .env.example .env                     # 编辑 .env，填写自己的密钥
# ANTHROPIC_API_KEY=sk-ant-...             # Claude

# 验证工程链路
bun run typecheck    # 全仓 strict tsc 零错误
bun run lint
bun test             # 无密钥时自动跳过 5 个 live 测试
bun run build        # WebUI 和 Electron 生产构建

# 桌面端
bun run dev:electron

# WebUI + headless 服务（演示同一套逻辑服务两种载体）
bun run server:headless 8787
bun run dev:webui    # 打开 http://localhost:5173
```

WebUI 启动后，使用 headless 终端输出的带 fragment 引导链接连接；随机 token 只保存在当前浏览器会话。服务默认监听本机，数据位于 `.threadcove-workspace/`。模型可通过 `THREADCOVE_PROVIDER` / `THREADCOVE_MODEL` 配置，任务设置支持持久化模型覆盖。

本次评审整改、兼容边界和验证步骤见 [整改说明](docs/IMPLEMENTATION-REVIEW.md)；OpenDesign 规范与实际前端移植见 [前端设计](docs/FRONTEND-DESIGN.md)。[OpenCode Go 接入说明](docs/OPENCODE-GO.md) 提供本机加密配置与真实 Pi SDK 验证方法。OpenCode Go / DeepSeek V4.1 Flash 已通过真实 SDK、宿主工具往返及 Web/Electron 联调；DeepSeek 直连接口和 Claude API 本次未验证。

**验证流式对话**（需要真实密钥，无需 UI）：

```bash
DEEPSEEK_API_KEY=sk-... bun run scripts/smoke-deepseek.ts
```

## 🎨 三个值得看的设计

### 1. redirect 双分支——统一接口不假装所有后端一样

```typescript
// pi-agent.ts — 有原生 steering：消息注入当前流，事件继续走
redirect(message: string): boolean {
  if (!this.isProcessing()) { this.forceAbort(AbortReason.Redirect); return false; }
  this.send({ type: 'steer', message });
  return true;   // ← true：会话层什么都不用做
}

// deepseek-agent.ts — 无原生 steering：内部排队，会话层决定重发时机
```

接口签名一个 `boolean`，把「各后端能力不同」这个事实诚实地暴露给上层，而不是用一个统一假象掩盖它。

### 2. EventQueue——不是 async generator 换皮

Claude 是同步 `for-await` 消费 SDK 流；Pi 子进程事件是**异步回调**到达。`EventQueue`（`enqueue` 推入唤醒 / `drain` 等待产出 / `complete` 收流 / `reset` 翻新）把 push 变 pull，让两种截然不同的喂法产出**同一个** `AsyncGenerator<AgentEvent>` 消费面。六个测试锁住：顺序保证、空队列等待、提前 complete 缓冲投递、reset 复用、交错生产。

### 3. 路由穷举——每条通道都被显式决策过

```typescript
// packages/shared/tests/routing.test.ts
test('every channel is classified exactly once', () => {
  for (const ch of all) {
    const inLocal = LOCAL_ONLY_CHANNELS.has(ch);
    const inRemote = REMOTE_ELIGIBLE_CHANNELS.has(ch);
    if (!inLocal && !inRemote) throw new Error(`Channel "${ch}" 未分类`);
    if (inLocal && inRemote)  throw new Error(`Channel "${ch}" 双重分类`);
  }
});
```

新增通道不分类 → CI 直接红。「文件对话框只能在桌面走，会话内容两端都要走」不是约定俗成，是测试强制的架构约束。

## 📡 传输协议（摘要）

```text
client → { type:'handshake', protocolVersion:'1.0', token?, workspaceId? }
server → { type:'handshake_ack', clientId, registeredChannels }

request  { id, type:'request',  channel:'sessions:sendMessage', args:[...] }
response { id, type:'response', result:{...} } | error { code:'CHANNEL_NOT_FOUND', message }
event    { id, type:'event',    channel:'session:event', args:[{ sessionId, event:AgentEvent }] }
```

- 二进制走 `{"__tcRpcType":"u8","base64":"..."}` 标注编码，两端无损还原
- 错误码：`HANDLER_ERROR` · `CHANNEL_NOT_FOUND` · `AUTH_FAILED` · `PROTOCOL_VERSION_UNSUPPORTED` · `REQUEST_TIMEOUT`（类标识不跨线，接收端按 `err.code` 分支）
- 非 localhost 明文 `ws://` 一律拒绝（token 明文防护）
- 完整通道分类表与 envelope 细节见 **[docs/PROTOCOL.md](docs/PROTOCOL.md)**

## 🔒 安全模型

- **凭据**：AES-256-GCM 加密落盘（`credentials.enc`，64B 头 + PBKDF2(机器硬件 ID ∧ 随机盐, 100k 轮)）——文件拷到别的机器解不开。机器标识是**密钥派生输入**，不是密钥本身
- **进程边界**：MCP/API 源凭据只在宿主进程；Pi 子进程执行源工具时发 `tool_execute_request` 回宿主，**凭据永不进入子进程环境**
- **渲染进程**：preload 只有引导逻辑，无手工 IPC 分发表；`contextIsolation: true`；未分类通道过不了路由穷举测试
- 细节与已知边界见 **[docs/SECURITY.md](docs/SECURITY.md)**

## 🧪 测试地图

| 套件 | 护住什么 |
|---|---|
| `routing.test` | 通道分类穷举：完备/总数相等/零交集/非空 |
| `codec.test` | envelope 往返含二进制标注编码、畸形包拒绝 |
| `event-queue.test` | push→pull 桥：顺序/等待/收流/复位/交错 |
| `factory.test` | provider→backend 路由、未知 provider 抛错、生命周期面 |
| `claude/pi-event-adapter.test` | 双后端原生事件 → 统一词表快照 + 未知事件容错 |
| `pi-protocol.test` | 真实子进程：init→ready 握手、事件流、tool_execute 往返、坏 JSONL 容错、abort、redirect 双分支 |
| `session-event-message-parity.test` | 事件字段 ↔ 持久化字段双端一致（防字段漂移） |
| `sessions.test` | 双会话物理隔离、路径穿越、归档/删除、并发持久化、`{{SESSION_PATH}}` 往返（含 Windows 转义） |
| `sources.test` | 三层 header 优先级、缺 token→null、Authorization 三态、AES 加解密往返+换机失败、代理命名映射、SKILL.md 校验 |
| `transport/bootstrap.test` | 真实 WS 收发、token 鉴权、广播、buildClientApi、明文 ws:// 拒绝 |
| `integration.test` | 端到端：建会话→发消息→收流→落盘、多会话隔离、后端切换、typed error code |
| `deepseek.test` | 无密钥 typed_error；**有密钥时跑 live**：流式/用量/中断/标题生成 |

## 📚 文档

- **[docs/REPRODUCTION_SPEC.md](docs/REPRODUCTION_SPEC.md)** — 完整复现规格：范围/深度/边界/不做清单
- **[docs/PROTOCOL.md](docs/PROTOCOL.md)** — 传输协议：envelope 格式 + 通道分类表
- **[docs/SECURITY.md](docs/SECURITY.md)** — 凭据加密模型 + 安全设计动机

## 🗺 边界（诚实交底）

- **不做**：RAG/向量库（主打实时抓取+多源核对）、多 Agent 编排（多任务=多 Session）、Memory/跨任务知识复用、完整 OAuth（凭据手动粘贴，只留 `getToken` 钩子）
- **MCP 只到统一转换层**：官方 SDK Client + 代理工具组装，不自研 JSON-RPC/握手
- WebUI 定位是「验证同一套逻辑能否复用」的接续查看面，不是全功能第二产品
- Pi 后端已接入真实 `createAgentSession`，默认注册免密钥搜索、公开网页读取及最多 3 个并发子任务；详见[研究工具与预算](docs/RESEARCH-TOOLS.md)
- 已有真实 OpenCode Go API / Pi SDK / Web / Electron 验收，以及两个真实子任务搜索、读取、来源落盘和刷新恢复验证。自动测试不使用个人 API 密钥，DeepSeek 直连 live 测试默认跳过；1M 上下文尚未实测满窗口

## License

MIT
