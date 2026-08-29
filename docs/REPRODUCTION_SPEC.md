# ThreadCove 复现文档（五选点子集 · 工业级工程实践风格）

> 生成日期：2026-08-25 ｜ v3 换点更新：2026-08-29 ｜ 范围控制修订：2026-08-30 ｜ 依据：`E:/zzzz/mini/Craft-定稿.md`（面试口径真相源）+ `E:/zzzz/mini/craft-agents付费版内参/craft-agents-oss-main`（参考实现，仅供机制查证）
> 用途：交给编码 AI 或自己开工的完整施工规格。**只复现五个选点（R03/R08/R10/R12/R18），架构、验证、CI、文档等成色对标工业级工程实践风格（注意：是工程实践风格，不是企业级系统——没有数据库/RBAC/监控/容灾，被追问时按 §7 口径画界）。**
> **范围控制（2026-08-30）**：依赖关系 **R03→R10**（R10 消费 R03 的事件产出）；**R08、R18 相互独立**（Session/Workspace 持久化与能力接入都不依赖事件层，与 R03/R10 仅在运行时汇合）；**R12 最后汇总承载**（把三者经统一协议送到多端）。施工顺序按 R03→R10→R08→R18→R12 线性排，但**这是施工顺序，不是严格的代码依赖关系**——被追问依赖结构时按本句答。各点深度按本表 MUST/OPTIONAL 执行，未选点**不得实现、不得形成可调用入口**（做出来能用比不做更危险——每多一个入口就是一片新追问面）。
>
> **真相源层级**：本文件（怎么建）＞ `Craft-定稿.md`（说什么话、什么红线）＞ 参考仓库源码（只用来核对机制细节，**不是逐文件克隆的模板**）。
> **标注约定**：✅＝已在参考源码核实（附出处）；🔧＝设计决策（自行定值，写出理由即可，面试报自己的取值，别背参考仓库的数）。

---

## 1. 目标与世界观

一句话：**个人深度研究/信息分析工作台**——复杂问题拆成多个研究任务并行推进（搜索→阅读→分析→汇总），每个任务独立 Session 与工作区；按任务阶段选模型（抓取整理求快省、分析综合求强推理）；外部能力（搜索 API/网页抓取/本地文档/MCP）统一接入。

- 使用者＝本人（定稿红线：**严禁虚构使用主体/业务反馈**，「单人高频迭代所以契约锁死」是全场最好用的叙事牌，§5-6）。
- 形态：Electron 桌面主力 + WebUI 接续查看——双端的重点是「传输层只写一遍」，不是两个产品（§5-5 真话口径）。
- 边界（不进 bullet，面试口径）：不做 RAG/VectorDB；不做多 Agent 编排（多任务=多 Session 隔离）；不做复杂 Memory（演进方向）；「深度研究」=流程编排非产品复刻；简历不写英文 "Deep Research"。
- 模块分层（代码结构按此组织，与定稿 §2 世界观一致）：

```text
依赖关系：R03→R10（事件管线）；R08、R18 独立成块；R12 汇总承载 → UI/CI
施工顺序（线性，非严格代码依赖）：R03 → R10 → R08 → R18 → R12
研究任务 = Session（会话上下文 + 工具上下文 + 独立工作目录）
└── Workspace（rootPath：偏好默认值 / sources / skills / sessions 存储）
    └── AgentBackend（anthropic=进程内 SDK ／ pi=进程外 JSONL 子进程）——产出原生事件（R03）
        └── AgentEvent 统一词表 × 双后端适配 × EventQueue 桥 × typed_error 恢复（R10 消费 R03 产出、定义契约）
            └── Session/Workspace 隔离（R08）· Source→Tool 能力接入（R18）——与事件层在运行时汇合
                └── 传输层 CHANNEL_MAP + WsRpc + 路由穷举（R12）把一切送到多端 UI
```

## 2. 复现范围总表

| 选点 | 复现内容 | 深度 |
| --- | --- | --- |
| 地基 | Bun workspace monorepo + `packages/core` 类型层 + Electron 主/preload/renderer 最小会话 UI（流式渲染）+ Claude 后端端到端跑通 + `runMiniCompletion` 标题生成 | MUST |
| R03 后端抽象 | AgentBackend 接口 + BaseAgent 精简基类 + Driver 工厂 + MODEL_REGISTRY 能力字段 + **Pi 第二后端（JSONL 子进程 + 工具代理回宿主）**——R03 只负责把 Pi 原生事件**送入 R10 的统一事件管线**（事件适配器/EventQueue 均归 R10，见 §6.5） | MUST，全保真（Pi 是最高危追问点，不能省） |
| R03 | redirect 双分支语义 / interruptForHandoff / abort·forceAbort | MUST（接口级 + 至少一个后端真实行为） |
| R08 任务隔离 | Workspace rootPath+defaults、session.jsonl 存储+子目录、sanitizeSessionId 防穿越、persistence-queue 串行化、生命周期 CRUD、按会话 workingDirectory 隔离 | MUST，全保真 |
| R08 | 归档/Flag/已读跟踪 | MUST-lite（header 字段 + 列表过滤即可） |
| R18 能力接入 | **核心链（MUST）**：Source 三型目录制（mcp/api/local）→ SourceServerBuilder（stdio/http/sse + 三层头优先级）→ 凭据存储（AES-256-GCM 机器绑定）→ McpClientPool 代理工具命名 → api-tools 单灵活工具 | MUST，全保真（核心链=「Source → Credential → Client/Proxy → Tool」主线） |
| R18 | Skill(SKILL.md) 加载与 requiredSources | MUST-lite（frontmatter 解析+requiredSources 校验即可，不做什么技能市场） |
| R18 | OAuth 流程（Google/Slack 授权舞蹈）、McpPoolServer HTTP 端点、OpenAPI 导入解析、Token 刷新管理 | OPTIONAL（凭据用手动粘贴 token，getToken 钩子预留接口即可） |
| R12 统一传输 | **核心链（MUST）**：protocol 包 channels/dto/routing+穷举测试 → CHANNEL_MAP → WsRpcServer/WsRpcClient（握手/token/codec）→ buildClientApi → RoutedClient → WebUI adapter 覆写 → headless 入口 | MUST（核心链就是选点本身） |
| R12 | 心跳 30s/seq 事件重放（环形缓冲）/make-before-break 重订阅/thin-client 模式 | OPTIONAL-lite（工程加分项，时间紧可砍：心跳退「连接断开即报错」、重放退「断线重连拉全量」，**但 routing 穷举测试永远必做**——它是 R12 的灵魂细节） |
| R10 事件流 | AgentEvent 可辨识联合（五类核心+辅助型）+ turnId/parentToolUseId 关联 + 双后端事件适配（Claude 同步流/Pi EventQueue 桥）+ typed_error 结构化错误恢复 + UI 按 type 分流渲染 + session-event-message parity 测试 | MUST，全保真 |
| 工程底座 | tsc 全仓 strict 链 + GitHub Actions CI（R24 已移出选点，机器降级见 §6.6） | MUST-lite |
| 工程底座 | husky pre-commit / channel-map-parity / ESLint 边界规则 / check-raw-sends（R24 遗产，详见 §6.6） | OPTIONAL |

## 3. 技术栈定版（对齐参考仓库 package.json，✅ 已核实）

| 层 | 选型 | 备注 |
| --- | --- | --- |
| 运行时/构建 | Bun ≥1.3（workspace + test runner），CI 锁 1.3.10 ✅ validate.yml | dev 直跑 ts，无需构建步 |
| 语言 | TypeScript ^5 strict，`"type": "module"` | typecheck = 各包 `tsc --noEmit` 串联 |
| 桌面 | Electron ^39 ✅ | 主进程内嵌 WS server |
| 前端 | React ^18.3 + Vite ^6 + Tailwind ^4 ✅ | 🔧 状态管理 zustand 或 jotai 二选一；markdown 用 react-markdown；**不要搬 tiptap/radix 全家桶**（renderer 最小化，重心在机制层） |
| WebSocket | `ws` ^8 ✅ | 传输层唯一依赖 |
| Claude 后端 | `@anthropic-ai/claude-agent-sdk` **精确锁版 0.3.220** ✅ | `query()` + `createSdkMcpServer`/`tool` |
| Pi 后端 | `@earendil-works/pi-ai` + `@earendil-works/pi-coding-agent` **精确锁版 0.80.6** ✅ | 只进 `packages/pi-agent-server` 子进程 |
| MCP 客户端 | `@modelcontextprotocol/sdk` ^1.29 ✅ | Client 连 stdio/http server；**不自研协议**（自爆口径的代码事实） |
| 校验 | zod ^4 ✅ | 配置与边界 |
| 质量 | bun test、ESLint 9 flat config + 自定义规则目录、GitHub Actions ✅ | 见 §7 门槛 |

**明确不用**：数据库/ORM（纯文件存储）、Express（WS server 自写）、Sentry、i18n 框架、electron-updater、tiptap 编辑器栈。
包结构四个 npm 包：`packages/core`（纯类型）+ `packages/shared`（协议/agent/sources/sessions/workspaces/credentials/config）+ `packages/pi-agent-server`（子进程）+ `apps/electron`（含 transport 与内嵌 server）+ `apps/webui`（薄 adapter）。

## 4. 架构与目录

```text
craft-workbench/                  # 🔧 项目改名（避开 Craft 商标词根，见提醒#4）
├── package.json                  # bun workspace 根 + validate/lint/typecheck 脚本
├── packages/
│   ├── core/src/                 # 纯类型层（对齐参考仓库定位）：AgentEvent/Session/Workspace/Message
│   ├── shared/src/
│   │   ├── protocol/             # R12：channels / dto / events / routing / types + routing 穷举测试
│   │   ├── agent/
│   │   │   ├── backend/          # R03：types.ts(AgentBackend) / factory.ts(DRIVER_REGISTRY)
│   │   │   │                     #      internal/drivers/{anthropic,pi}.ts
│   │   │   ├── base-agent.ts     # R03：公共状态与核心模块委托
│   │   │   ├── claude-agent.ts   # 进程内 SDK 后端
│   │   │   ├── pi-agent.ts       # R03：JSONL 子进程客户端 + 工具代理
│   │   │   └── core/             # 🔧 精简：permission/source/prompt/usage 四个 manager
│   │   ├── sources/              # R18：server-builder / api-tools / credential-manager / storage / types
│   │   ├── credentials/backends/ # R18：secure-storage（AES-256-GCM）
│   │   ├── sessions/             # R08：storage / jsonl / persistence-queue / validation(slug sanitize)
│   │   ├── workspaces/           # R08：storage / types(WorkspaceConfig.defaults)
│   │   ├── skills/               # R18：SKILL.md 加载 + requiredSources
│   │   └── config/               # MODEL_REGISTRY（能力字段）/ llm-connections
│   └── pi-agent-server/src/      # Pi 子进程入口：stdin/stdout JSONL 循环 + Pi SDK 进程内运行
├── apps/
│   ├── electron/
│   │   ├── src/
│   │   │   ├── main/             # 窗口管理、内嵌 server 启动、__get-ws-port 等引导 IPC
│   │   │   ├── server/           # R12 服务侧：ws-server + handlers/*（sessions/files/sources/auth…）+ SessionManager
│   │   │   ├── transport/        # R12：channel-map / build-api / routed-client / client / codec
│   │   │   ├── preload/bootstrap.ts  # contextBridge.exposeInMainWorld(buildClientApi(...)) —— 无手工 IPC 面
│   │   │   ├── renderer/         # React 会话 UI（流式渲染、会话列表、sources 设置最小面）
│   │   │   └── shared/types.ts   # ElectronAPI 接口 = 前端 API 面（channel-map parity 守卫为 OPTIONAL，见 §6.6）
│   │   ├── eslint-rules/         # 自定义规则（OPTIONAL，§6.6）
│   │   └── eslint.config.mjs
│   └── webui/src/adapter/web-api.ts  # 复用 electron transport + CHANNEL_MAP，只覆写 LOCAL_ONLY 方法
├── scripts/check-raw-sends.sh    # R24：自写（⚠️ 参考仓库此脚本被剥离，见提醒#2）
└── .github/workflows/validate.yml
```

**数据流（三条汇到同一条执行路径）**：

```text
UI 调用：renderer.window.api.*（buildClientApi 代理）
        → RoutedClient（LOCAL_ONLY→本地 WsRpcClient；REMOTE_ELIGIBLE→workspaceClient）
        → WS envelope(codec) → WsRpcServer.handle(channel) → handlers → SessionManager
执行：  SessionManager → AgentBackend.chat()
        ├─ anthropic：进程内 SDK query() 流式事件
        └─ pi：spawn 子进程 → JSONL init/prompt → event 行 → EventQueue → 同一 AsyncGenerator 面
        → AgentEvent 统一事件流 → push('session:event') → 所有客户端
能力：  Source 激活 → SourceServerBuilder(+credential-manager) → McpClientPool 代理工具（mcp__{slug}__{tool}）
        → 后端拿代理定义；调用经 pool（宿主）或 tool_execute_request（Pi 子进程反向代理回宿主）
```

## 5. 存储模型（纯文件，无 DB；✅ 目录布局核实自参考仓库）

```text
~/.<app>/                             # 🔧 改名
├── config.json                       # StoredConfig：authType / workspaces[] / activeWorkspaceId / activeSessionId / model
├── credentials.enc                   # R18：AES-256-GCM 加密凭据库（CRAFT01 式 64B 头：magic+flags+salt；payload：IV+GCM tag+密文）
│                                     # 密钥 = 以机器标识（IOPlatformUUID/MachineGuid/machine-id）作为 KDF 输入，PBKDF2 派生加密密钥——机器绑定，拷走文件解不开（⚠️ 口径：机器标识是 KDF 输入不是密钥本身）
└── workspaces/{slug}/                # Workspace.rootPath（支持任意磁盘位置）
    ├── workspace.json                # WorkspaceConfig.defaults：model/defaultLlmConnection/enabledSourceSlugs/
    │                                 #   permissionMode/cyclablePermissionModes/workingDirectory/thinkingLevel…
    ├── sources/{sourceSlug}/
    │   ├── config.json               # type:'mcp'|'api'|'local' + transport/url/command + authType + isAuthenticated
    │   └── guide.md                  # 用法指引（YAML frontmatter + 正文）
    ├── skills/{skillSlug}/SKILL.md   # name/description/globs/alwaysAllow/requiredSources
    └── sessions/{sessionId}/
        ├── session.jsonl             # 行1 = SessionHeader；行2+ = StoredMessage（一行一 JSON）
        │                             # 写入后绝对会话路径替换为 {{SESSION_PATH}} token（Windows 双反斜杠也处理）
        └── attachments/ plans/ data/ long_responses/ downloads/
```

- **写入串行化**（✅ persistence-queue.ts）：每会话一个持久化队列，防抖合并写；header 元数据签名比对（外部改的名/状态不被内存旧值覆盖）；临时文件 + rename 原子落盘。
- **路径安全**（✅ sessions/storage.ts）：`getSessionPath` 内先过 `sanitizeSessionId()`（剥离路径成分），docblock 原话 defense-in-depth——调用方校验之外的第二道闸。
- **迁移协议**：config.json 带 schemaVersion；升级前备份；拒绝降级（对齐 HappyClaw 复现文档同款纪律）。

## 6. 五个选点实现规格

### 6.1 R03 · AgentBackend 抽象 + Pi 进程外第二后端（先做，一切的地基）

**口径锚点**：定稿 §1-R03、talking R03、防线 §5-1（Pi，最重要）、§5-3（成本反杀）、Q&A R03 组、Part3 #1/#6。效果槽限定**后端/供应商层**——不碰「按任务动态切换模型」语义（那是别的项目的地盘）。

**接口形状**（✅ 全部核实自 `packages/shared/src/agent/backend/types.ts` 的 AgentBackend 接口）：

```ts
interface AgentBackend {
  // 核心循环
  chat(message: string, attachments?: FileAttachment[], options?: ChatOptions): AsyncGenerator<AgentEvent>;
  abort(reason?: string): Promise<void>;
  forceAbort(reason: AbortReason): void;
  interruptForHandoff(reason: AbortReason): void;
  /** 中途改道：有原生 steering 的后端注入当前流返回 true；没有的内部 forceAbort 返回 false，
      会话层排队重发 —— 「统一接口不假装所有后端一样」的活例子 */
  redirect(message: string): boolean;
  runMiniCompletion(prompt: string): Promise<string | null>;   // 标题生成/摘要
  postInit(): Promise<PostInitResult>;                          // auth 注入结果 + 警告
  destroy(): void; dispose(): void;
  // 模型/思考档/权限模式
  getModel(): string; setModel(m: string): void;
  getThinkingLevel(): ThinkingLevel; setThinkingLevel(l: ThinkingLevel): void;
  getPermissionMode(); setPermissionMode(); cyclePermissionMode();
  respondToPermission(requestId: string, allowed: boolean, alwaysAllow?: boolean): void;
  readonly supportsBranching: boolean;
  // 回调组（facade 构造后注入）：onPermissionRequest / onAuthRequest / onSourceChange /
  //   onBackendAuthRequired / onSpawnSession …
}
// BackendConfig.provider: 'anthropic' | 'pi' 决定实例化哪个后端
```

**统一事件流**（✅ `packages/core/src/types/message.ts:550` AgentEvent 联合——**类型定义归 R10 所有**，此处 R03 只声明「chat() 返回 AsyncGenerator<AgentEvent>」的接口契约；词表详情见 §6.5）。

**BaseAgent 抽象类**（✅ base-agent.ts:164）：持有公共状态（model/thinking/workspace/sessionId）+ 委托核心模块（PermissionManager/SourceManager/PromptBuilder/UsageTracker；🔧 复现精简到这四个）；子类实现 `chatImpl/abort/forceAbort/isProcessing/respondToPermission/runMiniCompletion/queryLlm`。

**工厂与驱动**（✅ factory.ts）：`DRIVER_REGISTRY: Record<'anthropic'|'pi', ProviderDriver>`，driver 负责 `buildRuntime`（组装 SDK 参数）与可选 `fetchModels`（动态模型列表）；LlmConnection（slug/providerType/authType）决定 SDK 选择与凭据路由。

**能力表达（⚠️ 重要事实）**：参考仓库接口的文档注释写着「selectors read from capabilities()」，**但 OSS 快照的接口本体并没有 capabilities() 方法**——能力实际由三件套表达：① MODEL_REGISTRY 静态字段（`ModelDefinition{id, name, contextWindow, supportsThinking?, supportsImages?}`，models.ts:94）② driver.`fetchModels` 动态拉取 ③ `supportsBranching` 标志。🔧 复现二选一：(a) 沿用注册表+驱动方案；(b) 自己设计一个 `capabilities()` 方法挂上接口。**面试报自己的设计与理由**，talking 里「配置标记+运行时能力白名单」对应的就是这套组合，别虚构「能力协商协议」这种重词。

**Pi 第二后端（防线 §5-1 的全部证据，逐项落实）**（✅ pi-agent.ts / pi-agent-server/）：
1. **进程隔离**：主进程 spawn `pi-agent-server` 子进程，Pi SDK 在子进程内运行；重依赖崩了不拖垮宿主。
2. **JSONL 协议**：stdin/stdout 每行一个 JSON。宿主→子命令三种：`init`（apiKey/model/cwd/thinkingLevel/sessionPath/branchFrom* 等，pi-agent.ts:545 起）、`prompt`、`abort`（:2292）。`send()` 就是 `JSON.stringify(cmd)+'\n'`（:886），readline 逐行解析。
3. **子进程→宿主响应分发**（:911–1002）：`ready` / `event`（转发 AgentEvent）/ `pre_tool_use_request` / `tool_execute_request` / `session_tool_completed` / `mini_completion_result` / `llm_query_result` / `ensure_session_ready_result` / `session_id_update` / `error`。
4. **工具代理回宿主**（:267–271, :936）：`pendingToolExecutions: Map<requestId, {resolve,reject}>`——子进程遇到 MCP/API/session 工具不发外部请求，而是发 `tool_execute_request` 让宿主经 McpClientPool 执行，结果回写。**凭据永远只在宿主进程**。
5. **事件出口（归口 R10）**：Pi 子进程异步事件 → R10 的 EventQueue 桥 → chat() 的 AsyncGenerator。R03 侧只负责把 Pi 原生事件**原样送入 R10 的统一事件管线**——队列本体、事件适配器（PiEventAdapter）都归 R10 所有（§6.5-2/3）；面试讲法：R03 侧只说「Pi 原生事件进入统一事件管线」，映射与队列机制留给 R10 展开。

**必备测试**：工厂按 provider 路由、未知 provider 抛错；Pi 协议集成测试（mock 子进程：init→ready 握手、prompt→event 序列、abort 中止、`tool_execute_request`→宿主执行→响应回写、坏 JSONL 行容错不断流）；redirect 双分支语义各一例。（⚠️ 事件适配器测试「Pi fixture → 统一事件形状快照」**归 R10**，见 §6.5-6——R03 只测原生事件能完整送入管线，不测映射。）

### 6.2 R08 · Session/Workspace 隔离

**口径锚点**：定稿 §1-R08、talking R08、防线 §5-4（多开窗口反杀）、Q&A R08 组。说「隔离使任务可并行」，不说「调度编排」。

1. **Workspace 定义环境**（✅ workspaces/）：rootPath 支持任意磁盘位置（默认 `~/.<app>/workspaces/`）；`WorkspaceConfig.defaults`（workspaces/types.ts:33）承载偏好隔离——model/默认连接/启用 sources/permissionMode/workingDirectory/thinkingLevel。**同一工作区可跑多个会话；销毁 Session 不破坏 Workspace 积累的资料**（talking 权衡的代码落点）。
2. **Session 隔离状态**（✅ sessions/storage.ts 头注）：每会话一个目录 + session.jsonl + attachments/plans/data/long_responses/downloads 子目录；SessionStatus（todo/in_progress/needs_review/done/cancelled）+ isArchived/isFlagged/lastReadMessageId。
3. **隔离语义落地为一件事**：每会话的 `workingDirectory` 默认指向会话目录，工具执行 cwd 按会话注入——两个并行研究任务的搜索结果/下载/中间产物物理分家。这就是「不是多开窗口」的技术实质。
4. **JSONL 可移植化**（✅ jsonl.ts）：写入后把绝对会话路径替换为 `{{SESSION_PATH}}` token（含 Windows JSON 转义双反斜杠场景），读取前展开——会话文件夹移动/换机不烂。
5. **生命周期**：create（slug 唯一化）/archive（保留数据仅标记）/delete（整目录 rm）；SessionManager 维护 workspaceId→活跃 sessionId 映射。
6. **明确不做**：多租户/行级权限（Q&A 主动交底：文件系统级隔离，行级需上层 DB/RLS）；Memory/跨任务知识复用（演进方向）。

**必备测试**：双会话同工作区互不可见（cwd/文件）；`sanitizeSessionId` 拒绝 `../` 与绝对路径；delete/archive 行为；并发持久化最终一致且 header 外部元数据不丢；`{{SESSION_PATH}}` 往返。

### 6.3 R18 · 统一能力接入层

**口径锚点**：定稿 §1-R18（效果槽=「统一接入与调用」，不说调度）、防线 §5-2（MCP 先发自爆）、Q&A R18 组、Part3 #2。

1. **Source 三型目录制**（✅ sources/types.ts 头注）：`'mcp' | 'api' | 'local'`，每源一个目录（config.json + guide.md）——配置、用法说明、凭据引用都在源维度收敛。
2. **SourceServerBuilder**（✅ server-builder.ts）：`buildMcpServer` 产出 stdio（command/args/env）或 http/sse（url/headers）两种 SDK 兼容配置；**三层头叠加优先级**（代码注释原话）：配置静态头 < 凭据库多头凭据 < `Authorization: Bearer` 最高；声称已认证但 token 缺失 → 返回 null（needs re-auth）；`SERVER_BUILD_ERRORS` 常量统一错误匹配。`buildApiServer` 对 Google/Slack 类走 `getToken()` 钩子——每请求取新 token，天然支持续期（复现只留钩子，OAuth 舞蹈不做）。
3. **API→单一灵活工具**（✅ api-tools.ts）：每个 API 源只生成**一个**工具 `api_{name}`，入参 `{path, method, params}`，鉴权自动注入；`buildAuthorizationHeader` 三态（Bearer / 自定义前缀如 Token / 裸 token）。
4. **McpClientPool 中央池**（✅ mcp-pool.ts:102）：主进程集中持有全部 MCP 连接，代理工具名 `mcp__{slug}__{originalName}`；docblock 四条好处（单一代码路径/跨会话共享连接/无凭据缓存文件/运行时切换不重启）就是 bullet「凭据注入与权限配置集中管理」的证据链。
5. **凭据存储**（✅ credentials/backends/secure-storage.ts）：AES-256-GCM 加密文件；64 字节头（magic "CRAFT01\0"+flags+salt）；**以机器标识（macOS IOPlatformUUID / Windows MachineGuid / Linux machine-id）作为 KDF 输入，PBKDF2 派生加密密钥**——机器绑定。⚠️ 口径注意：别说「UUID 是密钥」——机器标识只是密钥派生的输入之一（配合 salt 经 PBKDF2 多轮运算），被追问加密细节时按这句讲。设置页手动粘贴 token 录入（OAuth 流程不做）。
6. **Source × Skill 分离**（✅ skills/types.ts）：Skill = SKILL.md frontmatter（name/description/globs/alwaysAllow/**requiredSources**）；Source 管连接/凭据/配置，Skill 管使用逻辑——talking 权衡句的代码落点。
7. **MCP 口径边界（复现范围）**：用官方 SDK 的 Client 连 server + 转成代理工具定义，**到此为止**；不自研 JSON-RPC/握手/传输。McpPoolServer（HTTP 端点给外部 SDK 子进程共用）不做——Pi 走 tool_execute_request 代理已覆盖。
8. **明确不做**：搜索聚合/抓取清洗等具体研究工具（那是「自建适配器」话题，平台只管接入治理）；技能自动生成（演进方向）。

**必备测试**：三层头优先级快照；缺 token 且 isAuthenticated → null；stdio 缺 command → null；Authorization 三态拼接；凭据加解密往返 + 换机器密钥解密失败；pool sync 后代理工具名映射与原始名还原正确。

### 6.4 R12 · IPC/WebSocket 统一传输层

**口径锚点**：定稿 §1-R12、防线 §5-5（多端真话：Web 端是验证复用的第二个载体）、Q&A R12 组。**严禁追加「跨端无缝续接会话状态」**（依赖未选点 R09）。

1. **协议包 `packages/shared/src/protocol/`**（✅ 全部核实）：
   - `channels.ts`：RPC_CHANNELS 线格式字符串（`'sessions:get'` 这类）=稳定 API 契约，键路径可随意重组；
   - `events.ts`：BroadcastEventMap 类型化推送通道表（通道名→参数元组）；
   - `dto.ts`：RPC handler 与客户端共享的数据形状（从 app 层抽到协议层，两端免得互相伸手）；
   - `types.ts`：`PROTOCOL_VERSION='1.0'`；（OPTIONAL-lite 项：心跳 30s/最多漏 2 次、事件环形缓冲 500 条断线重连按 seq 重放补发——见 §2 总表，核心链不依赖它们）；
   - envelope 核心五型 MUST：`handshake/handshake_ack/request/response/event/error`（`sequence_ack` 属重放机制，随 OPTIONAL-lite）；codec 对 Uint8Array 做 base64 标注编码（`__craftRpcType`）。
2. **路由穷举表**（✅ protocol/routing.ts）：每条通道必须归 `LOCAL_ONLY_CHANNELS`（需要本地 OS/Electron：窗口、原生对话框、shell 打开…）或 `REMOTE_ELIGIBLE_CHANNELS`（跟工作区内容走）恰好其一；**穷举测试**（routing.test.ts ✅）强制新通道先分类，否则 CI 红——「每条通道都被显式决策过」是这条选点的灵魂细节。
3. **WsRpcServer 一类两用**（✅ server-core/transport/server.ts 头注原话）："Same class used locally (127.0.0.1, no auth) and remotely (0.0.0.0, auth)"；握手 token 鉴权、handle(channel, fn) 重复注册直接抛、`invokeClient` 反向调用；（OPTIONAL-lite：心跳计 miss、断线客户端事件环形缓冲重放）。
4. **客户端运行时生成**（✅ build-api.ts）：`buildClientApi(client, CHANNEL_MAP)` 按 map 生成 ElectronAPI 代理（invoke/listener/transform 三种条目、点号嵌套命名空间），替代手写 preload——参考仓库注释原话 "Replaces the 329-line preload"。
5. **RoutedClient 双客户端路由**（✅ routed-client.ts）：LOCAL_ONLY 恒走本地 client；其余走 workspaceClient；（OPTIONAL-lite：切工作区 make-before-break 重订阅 REMOTE_ELIGIBLE 监听——简化版「先断旧再建新，短暂丢事件可接受」也行，讲清取舍即可）。
6. **preload 只有引导面**（✅ bootstrap.ts）：常规模式=RoutedClient 双路；（OPTIONAL-lite：thin-client 模式 CRAFT_SERVER_URL=单 client 全走远端）；**非 localhost 明文 ws:// 直接抛错**（token 明文防护）——安全细节顺带讲，MUST 保留。
7. **WebUI 复用**（✅ webui/adapter/web-api.ts）：import **同一个** WsRpcClient + buildClientApi + CHANNEL_MAP + ElectronAPI 类型，只覆写 LOCAL_ONLY 方法（原生文件对话框→input[type=file]、主题→matchMedia…）；浏览器 cookie 随 WS upgrade 自动携带。**这个文件的厚度就是 bullet 效果槽「多端复用」的实物证据**——它只有覆写层。
8. 🔧 **复现裁剪**：handlers + SessionManager 放 `apps/electron/src/server/`（Electron 主进程内嵌启动）；另给一个 headless 入口（同一 server 无窗口启动，供 WebUI 单独演示）——十来行代码，把「同一套逻辑服务两种载体」变成可当场演示的事实。

**必备测试**：路由穷举（分类完备/总数相等/零交集）——**MUST**；LOCAL_ONLY 强制本地路由——MUST；codec 往返含二进制——MUST；明文 ws:// 拒绝——MUST；（OPTIONAL-lite 对应：工作区切换后监听重订阅、断线重连事件按 seq 重放不重不漏——做了才写）。

### 6.5 R10 · AgentEvent 统一事件流与生命周期

**口径锚点**：定稿 §1-R10、talking R10、**防线 §5-10（事件契约四件套：五类口径/turnId 关联/EventQueue 反换皮/permission_request 出处）+ §5-11（R03/R10 分工一句话）+ §5-12（评测越界反问预案）**、Q&A R10 组、Part3 #6/#9/#10/#11。事件协议是渲染/恢复契约，不是日志格式；评测/采样/度量是消费侧能力非本类型职责（Scope 红线）；恢复由消费侧（UI/会话层）决策，协议提供信息基础与统一恢复入口（C 必改口径）。

1. **事件联合类型**（✅ `packages/core/src/types/message.ts:550` `export type AgentEvent =`）：五类核心——文本增量（`text_delta`/`text_complete`）、工具（`tool_start`/`tool_result`）、权限（`permission_request`，含 `PermissionRequestType` 五子类）、错误（`error`/`typed_error` 结构化）、完成与用量（`complete`+`usage`/`usage_update`）——外加辅助型（`status`/`info`/`working_directory_changed`/`task_backgrounded` 等）。🔧 **复现裁剪**：核心五类+`status`/`info` 必做；后台任务/工作流类辅助型按需选二三个即可，不追全 21 型；面试口径只讲五类（防线 §5-10），被问「还有吗」再承认辅助型，是加分不是雷。核心事件带 `turnId`（来自 API `message.id`，归组一轮）与 `parentToolUseId`（嵌套工具调用树）关联字段 ✅——**字段诚实限定**（D雷2/B2）：`parentToolUseId` 可选，Claude 后端原生透传 SDK `parent_tool_use_id`，Pi 后端当时用 sub-turn 隔离近似，词表跨后端对齐但字段填充度按后端能力不同。

2. **双后端事件适配**（✅ `packages/shared/src/agent/backend/base-event-adapter.ts` / `claude/event-adapter.ts` / `pi/event-adapter.ts`）：`BaseEventAdapter` 抽象类提供共享状态——`turnIndex`/`currentTurnId`、`commandOutput`/`readCommands`/`blockReasons` 三个 `Map`、`startTurn()`（清状态+`onTurnStart` 钩子）、`setSessionDir`；子类各自实现 `adapt*()` 派发。Claude 侧：`stream_event`→`text_delta` 实时推送，`pendingText` 延迟等 `stop_reason` 再发 `text_complete`，每消息 `usage` 追踪，`typed_error` 构造例（`buildWindowsSkillsDirError`：`{code,title,message,details[],actions[],canRetry,originalError}` 结构）✅。Pi 侧：头注释完整映射表——`message_update`→`text_delta`、`message_end`→`text_complete`、`tool_execution_start`→`tool_start`、`tool_execution_end`→`tool_result`、`agent_end`→`complete`、`compaction_start`→`status`、`compaction_end`→`info`/`error`、`auto_retry_*`→`status`、`queue_update`→ignored；处理 Pi SDK 自动压缩竞态签名、`isContextOverflow` 兜底 ✅。🔧 **复现精简**：Claude 适配从简（SDK 事件直接近映射），Pi 适配做 4-6 条主映射+容错即可。

3. **EventQueue 桥**（✅ `packages/shared/src/agent/backend/event-queue.ts`）：`EventQueue` 类——`enqueue(event)`/`complete()`/`reset()`/`async *drain()`。为什么需要——Pi 子进程事件是异步回调到达，`chat()` 的消费面是 `AsyncGenerator`，队列解耦两侧节奏（`enqueue` 推入唤醒、`drain` 等待产出、`complete` 收流、`reset` 翻新）。这是「generator 换皮」质疑的结构性答案（对比 ClaudeAgent 同步 `for-await`：同一接口两种喂法）。**必备测试**：`enqueue`→`drain` 顺序往返、`complete` 后 `drain` 收敛、`reset` 后复用。

4. **typed_error 结构化错误恢复**（✅ `message.ts` `AgentError` 类型 + `claude/event-adapter.ts` 构造例）：`AgentError{code,title,message,details[],actions[],canRetry,originalError}`；UI 拿到后→错误卡渲染（`title`+`details` 可展开+`actions` 按钮）→`canRetry` 决定重试入口；对比裸 `error`（`string message`）只有 toast。研究场景外部来源易错（搜索 API 超时/抓取失败）——错误恢复是 R10 效果槽的实质。

5. **UI 分流与广播**：UI 按 `type` 分流渲染（`text` 增量拼接/工具卡/权限对话框/错误卡/完成汇总）；事件经会话层 `push('session:event')` 走 R12 传输层广播到多端（与 §6.4 呼应——R10 定义事件形状、R12 负责搬运，分工讲清）。

6. **必备测试**：双后端事件适配器快照（Pi fixture→统一事件形状）；`turnId` 归组与 `parentToolUseId` 嵌套树；EventQueue 往返三例；**session-event-message parity**（对齐参考仓库 `session-event-message-parity.test.ts` ✅：`text_complete`/`tool_start`/`tool_result`/`typed_error` 事件字段 ↔ `StoredMessage` 字段一致）；未知事件类型容错（`default` 分支丢弃+日志，不崩流）。

7. **边界口径**：本点是事件契约与渲染/恢复，不是行为评测（评测→防线 §5-12：采样/判定/裁判三独立问题+诚实交底）；「生命周期」指事件间关联与状态流转（turn 归组/工具树/错误恢复），**标题不用「状态机」**——无显式 FSM 状态转移表，被追问「状态机怎么建模」就按这句画界（口径：事件词表+关联字段+生命周期钩子，不是严格 FSM）。**permission_request 出处纠正（D雷3）**：该事件不是 adapter 产物——会话层安全管线在工具执行前拦截后发出（PreToolUse 拦截→`permission_request`→用户裁决→放行或记 block reason），复现时把发送点放会话层而非事件适配器，口径与代码一致。**R03/R10 分工（防线 §5-11）**：EventQueue 归 R10 所有；R03 只依赖它产出统一 AsyncGenerator 面——R03 讲「谁能被换」，R10 讲「换完之后流长什么样」。

### 6.6 OPTIONAL · R24 遗产机器（已移出选点，可选加固）

R24 换出后，以下机器从 MUST 降级为 OPTIONAL。面试口径仍有「类型检查」兜底（工程素养不算裸奔），代码可不做；做了就在 README 讲，不做就不提。

- **channel-map-parity 编译期 AssertNever 双向守卫**（原 §6.5-2 内容压缩）：`ElectronAPI` 方法集减去 preload 直实现白名单必须恰好等于 `CHANNEL_MAP` 键集，差集非 `never`→tsc 编译失败。
- **ESLint 抽象边界规则**（原 §6.5-5）：`no-restricted-imports` 禁主进程直引具体后端模块、`no-restricted-syntax` 禁 model-fetchers 裸 fetch 供应商 API。
- **自写 check-raw-sends 脚本**（原 §6.5-4；⚠️ 参考仓库被剥离的提醒保留在这）：grep 扫描 renderer/preload，白名单外出现 `ipcRenderer.invoke/send/sendSync` 即失败。
- **husky pre-commit**（staged 检查）。

## 7. 工程质量门槛（「工业级工程实践风格」的具体含义）

> ⚠️ 措辞口径：对外只说「工业级工程实践风格」或「工程实践习惯」，**不说「工业级」「企业级」**——后者会引面试官期待数据库/RBAC/监控/容灾/灰度这类企业系统标配，而本项目是个人学习工程，说大了必被追问穿帮。被问「这算工业级吗」→「是工程实践风格：类型严格、测试护住核心机制、CI 常驻、提交历史干净——单人也按团队标准约束自己，但不吹是企业级系统。」

1. **类型与格式**：全仓 tsc strict 零错误；Prettier + 仅检查改动文件脚本。
2. **测试**：bun test；§6 各点必备测试全绿是合并门槛；协议 codec/路由/契约三类测试常驻。
3. **CI（GitHub Actions）**：frozen-lockfile 安装 → typecheck → lint（含 raw-sends 与边界规则）→ test。单人也要走分支 + 自查——**提交历史本身是「工程素养」的展示面**：conventional commits、一个机制一串提交、禁止一把梭导入。
4. **日志**：结构化（ requestId/sessionId/backend）；凭据/token 绝不入日志。
5. **配置**：zod 校验环境变量（CRAFT_SERVER_URL/CRAFT_SERVER_TOKEN 等沿参考命名🔧可自定）；设置优先级 workspace defaults > 全局 config > 代码默认。
6. **文档实物**（面试可展示）：自写 README（架构图 + 诚实表格：「桌面端完整功能 / WebUI 为验证复用的接续查看面」）；`docs/PROTOCOL.md`（envelope 格式 + 通道分类表——R12 最强实物）；简版 SECURITY.md（凭据加密模型 + ws:// 明文拒绝 + preload 无 IPC 面的设计动机）。
7. **数据卫生**：`credentials.enc`、workspace 数据目录进 .gitignore；lockfile 提交；engines 字段。
8. **Windows 可移植**：CI 拒非法文件名字符（✅ validate.yml 有此步骤）；路径一律 `toPortablePath`/`{{SESSION_PATH}}` 模式——你在 win32 上开发，这些是你**真实的一手素材**（提醒#11）。

## 8. 明确不做清单（AI 最容易顺手加戏的地方，逐条禁止）

| 不做 | 理由 |
| --- | --- |
| 多租户/行级权限/RLS | Q&A 主动交底的边界：文件系统级隔离，硬撑必被戳穿 |
| Memory/跨任务知识复用、任何向量库/embedding/RAG | 定稿边界：场景选择（实时抓取+多源核对），交底话术已备 |
| 行为评测底座（pass^k/LLM 裁判/轨迹回放评测） | R10 Scope：评测/采样/度量是消费侧能力非事件类型职责；方法论认知未实现（诚实交底） |
| 多 Agent 编排 / workflow Conductor / tasks RPC 全家桶 | 未选点（参考仓库 tasks.ts handlers 整族跳过） |
| messaging 渠道网关（Telegram/WhatsApp worker 包） | **HappyClaw 项目的地盘——零共享铁律，绝不在此项目出现 IM 接入** |
| Docker 化 headless 服务集群（Dockerfile.server）、自动更新、Sentry | 性价比低且引来运维深挖 |
| McpPoolServer HTTP 端点、session-mcp-server/session-tools-core（session 自管理工具族） | 未选点深水区；Pi 工具代理已覆盖需求 |
| Session 分支 fork（branchFromSdkSessionId 族） | 未选点；接口注释里知道概念即可，代码不实现 |
| OAuth 完整授权流程 | 只留 getToken 钩子；凭据手动粘贴录入 |
| i18n 及其校验脚本 | 定稿步4 已删；被问按 Part3 #8 答「项目若有，与研究场景无关故未写简历」 |
| mini-agent 模式（MINI_AGENT_MCP_KEYS 那套） | 只保留 runMiniCompletion 一个方法做标题生成 |

**范围纪律（2026-08-30 修订）**：上表任何东西，**不得实现、不得形成可调用入口**——包括注释掉的脚手架、半能跑的雏形、能被 RPC/session tool 调到的入口。半成品比缺失更危险：一个残缺的可调用入口就是一整片追问面。

## 9. 关键提醒（口径 ↔ 实现 一致性，逐条都是审查踩过的坑）

1. **代码即证词**：简历/面试每句 claim 必须能在代码里指出实现；反之代码里每个机制你都得能讲。做完一块，回对定稿 §1 bullet 和 §5 防线再进入下一块。
2. **⚠️ check-raw-sends.sh 在参考仓库被剥离**：已随 R24 降级为 OPTIONAL（§6.6）；若选择实现则必须自己写（package.json 引用了 `lint:ipc-sends` 但脚本文件不存在），并且**不要在面试里描述你没见过的那个脚本的内容**，讲你自己写的检查逻辑。
3. **⚠️ capabilities() 只活在接口注释里**：OSS 快照的 AgentBackend 接口没有 capabilities() 方法本体，能力=MODEL_REGISTRY 静态字段 + driver.fetchModels + supportsBranching 三件套。你的实现选哪种就讲哪种（🔧 报自己的设计），talking 用「配置标记+运行时能力白名单」，禁用「能力协商」这类无实仓支撑的重词。
4. **License 是 Apache-2.0 且带 NOTICE 与 TRADEMARK.md**（不是 HappyClaw 那个 MIT）：复用须保留 LICENSE + NOTICE 归属声明；项目改名避开 "Craft" 商标词根；仓库呈现渐进生长的提交史而不是一次性导入。
5. **Pi 防线的每一句都要有代码**（全场最高危追问点，防线 §5-1）：进程外 JSONL（init/prompt/abort）、响应分发、pendingToolExecutions 关联 Map、EventQueue 桥接 AsyncGenerator——§5-1 承诺了什么，src 里就必须有什么。这块做完先自查一遍防线原文再继续。
6. **MCP 只到转换层的代码边界**：官方 SDK Client + 代理工具组装，到此为止；README/面试同口径（先发自爆，抢在被问前）。
7. **redirect() 双分支是 R03 的深度加分题**：steering 后端 true / 无 steering 后端 forceAbort+false——「统一接口不假装所有后端一样」。它与 HappyClaw R07 能力矩阵同思想但属不同项目，**面试别混着讲**。
8. **编号铁律**：Craft 的 R03=后端抽象、R08=Session隔离、R10=AgentEvent 事件流、R12=IPC/WS传输、R18=MCP接入——与 MiniCode/HappyClaw 的 Rxx 互不映射，绝不能跨项目套用语义（尤其 MiniCode R10=写前确认 diff）。
9. **效果全定性**：README 和简历不出现编造量化指标；「多端复用」的证据=webui adapter 文件真的只写了覆写层，让面试官看文件厚度。
10. **R03 效果槽限定后端层**：讲「后端切换收敛为配置层改动」（LlmConnection 换 slug/providerType 即换后端）；不碰「按任务阶段自动路由模型」的产品级语义（那超出抽象层职责，问题槽的成本动机用 §5-3 反杀讲）。
11. **Windows 一手素材**：你就在 win32 上开发——`{{SESSION_PATH}}` 可移植化、非法文件名 CI 检查、路径分隔符 ESLint 规则，都是你真实踩过的点，面试讲出来自带细节可信度。
12. **半成品清零**：§8 不做清单的东西连注释残迹都不要有；面试官顺着任何残迹追问都是新雷面。

## 10. 选点 ↔ 模块 ↔ 测试 ↔ 防线 映射（收口对照）

| Bullet | 模块 | 核心测试 | 定稿锚点 |
| --- | --- | --- | --- |
| R03 AgentBackend 抽象 | agent/backend/*、base-agent、claude-agent、pi-agent、pi-agent-server | 工厂路由、Pi 协议集成、事件适配快照、redirect 双分支 | §1-R03、§5-1/§5-3、Part3 #1/#6 |
| R08 Session/Workspace 隔离 | workspaces/、sessions/、SessionManager | 双会话隔离、sanitize、持久化串行、路径可移植往返 | §1-R08、§5-4、Part3 #3 |
| R18 统一能力接入 | sources/、credentials/、skills/、McpClientPool | 三层头优先级、null 再认证、Authorization 三态、加解密+换机失败 | §1-R18、§5-2、Part3 #2 |
| R12 IPC/WS 统一传输 | protocol/（核心链）、transport/、preload、webui/adapter、server/ | 路由穷举、LOCAL_ONLY 路由、codec 往返、明文拒绝（重订阅/seq 重放为 OPTIONAL-lite） | §1-R12、§5-5、Part3 #5 |
| R10 统一事件流与生命周期 | core/types/message(AgentEvent)、backend/base-event-adapter、event-queue、claude/pi event-adapter、session-event-message-parity | 双后端适配快照、turnId 关联、EventQueue 往返、parity 测试 | §1-R10、§5-10/§5-11/§5-12、Part3 #6/#9/#10/#11 |

**验收定义（Definition of Done)**：§7 全部门槛绿 + 五组核心测试绿 + 手工冒烟（发消息流式出字；LLM 连接从 anthropic 切到 pi 收发正常；开第二个 Session 并行任务目录互不污染；添加一个 stdio MCP 源其工具出现在对话中且凭据只在宿主进程；WebUI 连 headless 入口看到同一会话列表并收流式更新；mock 一个 Pi 子进程错误流，UI 呈现 typed_error 错误卡且可重试；未分类通道被路由穷举测试拦下；若实现了 OPTIONAL-lite 重放则「杀掉 WS 连接自动重连且事件补发不重复」才验，未实现则验「断线重连后 UI 状态恢复」）+ README/PROTOCOL/SECURITY 三份文档成形。
**依赖自检（收工前最后一步）**：能独立讲出「R03→R10 事件管线怎么接；R08/R18 各自独立做什么、在哪与事件层汇合；R12 怎么把三者汇总承载到多端」；§8 不做清单无任何可调用入口残留。
