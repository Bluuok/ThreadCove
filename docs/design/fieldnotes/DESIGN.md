# ThreadCove / FIELDNOTES LAB

## 设计定位

一个把问题、证据与推演放在同一工作现场的个人 AI 研究工作台。视觉核心是「研究图谱与档案批注」，不是营销页或装饰性仪表盘。首页图谱是唯一主要视觉表达，进入对话后完全收起。

本项目仅是独立 HTML 交互原型。所有任务、回复、文件、模型和运行状态均为示例。不连接账户、后端或模型，不读取文件系统，不使用真实用量数据。

## 文件与使用

- `index.html`：完整、自包含的应用原型；可直接打开。CSS、图谱 SVG 与脚本均内联，无网络依赖。
- `tokens.css`：用于真实应用移植的统一设计变量，与 HTML 内联变量保持一致。
- `DESIGN.md`：设计规则、交互说明、组件移植边界与验收说明。

无需图片、图像生成、外部字体、CDN 或构建工具。图谱是表达研究过程的抽象几何结构，不冒充真实数据图。

## 色彩规范

用户最新指定低饱和雾蓝 / 灰蓝色系。保留研究图谱与档案布局，移除电光紫、酸橙黄和纯黑品牌。生成式配色修订因本机服务重启失败，本版本由 Codex 通过本机 OpenDesign MCP 定点更新变量与文档。

| Token | 色值 | 用途 |
|---|---|---|
| `--bg` | `#edf2f5` | 浅雾蓝工作面 |
| `--surface` | `#f8fafb` | 索引与输入纸面 |
| `--fg` | `#263b4a` | 深墨蓝正文 |
| `--muted` | `#586e7e` | 灰蓝辅助文字 |
| `--border` | `#bac9d3` | 分隔线 |
| `--accent` | `#4b6d87` | 主动作与焦点 |
| `--accent-hover` | `#3a576e` | 主动作悬停 |
| `--accent-soft` | `#dde7ee` | 选中背景 |
| `--highlight` | `#b6ccd9` | 雾蓝身份标记 |
| `--ink` | `#263e50` | 深灰蓝身份栏 |
| `--on-ink` | `#f4f8fa` | 深色面板文字 |
| `--danger` | `#8a5058` | 错误状态 |
| `--success` | `#476959` | 连接状态 |

背景与文本保持清晰明暗差，辅助信息不依赖极浅灰。蓝色主按钮保留浅色文字；焦点使用 3px 灰蓝轮廓。无渐变，状态色只表达错误/连接。

## 字体与层级

工具应用采用单一系统 UI 字体体系，以等宽批注建立第二种阅读节奏。没有字体请求。

- 正文：`Segoe UI, Microsoft YaHei UI, PingFang SC, sans-serif`。
- 档案编号与批注：`Cascadia Code, Consolas, Microsoft YaHei UI, monospace`。
- 首页标题：30–46px，600，中文行高 1.4，字距 0。
- 对话标题：桌面 24px / 移动 21px，600。
- 正文：15px，400，行高 1.75–1.85；移动输入使用 16px。
- 辅助信息：12–13px；档案微标签为 10–12px，字距 0.07em。
- 控件：字距 0.02em；英文字母批注使用正字距，中文标题不使用负字距。

## 布局与精确间距

| 组件 | 桌面 | 390px 移动 |
|---|---|---|
| AppShell | 64px + 264px + 剩余空间 | 单列 100% |
| IdentityRail | 64px，顶部内距 22px | 隐藏 |
| TaskIndex | 264px，内距 24px 18px | 310px 抽屉，最多 86vw |
| WorkspaceHeader | 高 76px，水平内距 32px | 高 64px，水平内距 12px |
| ResearchCanvas | 水平内距 clamp(20px,4vw,64px) | 水平内距 20px |
| HomeComposition | 最大宽 1040px，图谱/手记 1.4:1 | 图谱单列，手记收起 |
| ResearchMap | 高 238px，列间距 24px | 高 178px |
| ConversationView | 最大宽 760px，消息间距 24px | 占可用宽度 |
| ComposerDock | 12px 顶距、20px 底距 | 8px 顶距、16px 水平、至少 14px 底距 |
| ResearchComposer | 内距 16px 18px 12px，圆角 12px | 内距 12px 12px 10px |
| DetailsPanel | 宽 460px，内距 24px | 最大宽 100%，内距 20px |
| ModelSettingsDialog | 宽 480px，内距 24px | 视口宽减 32px |

间距刻度：4 / 8 / 12 / 16 / 24 / 32 / 48px。常用圆角：6 / 12 / 20px。所有按钮和表单控件至少 44px 高。

根布局使用 `100dvh`；头部与输入区不收缩，只有中心内容滚动，不用整页滚动才能找到输入。390×844 下输入位于首屏底部；窄屏取消三栏、边注和冗余文案。760px 以下切换任务抽屉，1150px 以下图谱单列，1600px 以上增加画布留白。长任务名、文件内容和消息可换行。

## 交互路径

1. 首页输入或点击图谱节点填入问题；发送时才创建任务。
2. 逐步输出本地预设回复；停止操作保留已输出文字。
3. 切换任务恢复对应草稿；新建页有独立草稿槽。
4. 任务标题搜索支持进行中和归档列表；任务可归档、恢复。生成中或待权限确认时需先结束该状态。
5. 设置弹窗选择示例模型及运行场景，取消不保存；正常、失败、断连、权限确认可分别演示。
6. 失败后重试复用已经提交的问题，不重复插入用户消息。
7. 权限明确限定为内置示例文本；允许继续，拒绝取消。不存在真实授权调用。
8. 资料面板分为执行记录和来源文件，文件点击展开内容与示例来源。
9. 复制优先使用浏览器剪贴板；受限时选中正文并提示系统复制。正文始终是可选择的 DOM 文本。
10. 移动端任务抽屉可通过遮罩、关闭按钮或 Escape 关闭；设置弹窗使用原生 dialog。

持久化键：`threadcove-fieldnotes-v1`。仅保存任务、消息、草稿、演示设置；存储不可用时会提示。刷新后不伪装继续运行，将进行中状态恢复为已停止。仅允许一个模拟流式任务运行。

## React 移植映射

| React 组件 | 职责 / 建议接口 |
|---|---|
| `AppShell` | 三层网格、视口高度、响应式壳层 |
| `IdentityRail` | 首页与身份入口 |
| `TaskIndex` / `TaskDrawer` | 搜索、筛选、选择任务；共享同一列表数据 |
| `TaskListItem` | title、state、draft 标记、当前选择 |
| `WorkspaceHeader` | 当前任务、模型设置、执行详情入口 |
| `ResearchHome` / `ClueMap` | 首页引导；onPrompt、onOpenSources |
| `ConversationView` / `MessageBlock` | 稳定 messageId、可选择文本、复制；按消息局部更新 |
| `ResearchComposer` | taskId、draft、onDraftChange、onSubmit、onCancel |
| `ExecutionStatus` | idle / awaiting_permission / streaming / stopped / failed / completed |
| `PermissionPrompt` | 权限范围、允许与拒绝；真实授权需服务端验证 |
| `ModelSettingsDialog` | 临时表单状态；保存后提交配置 |
| `DetailsPanel` / `SourceFilePreview` | 执行记录和资料内容；真实路径由受限文件接口提供 |
| `ConnectionIndicator` / `ErrorNotice` | 根据实际连接生命周期报告状态 |

建议 `useReducer` 管理 taskId → {messages, draft, archived, status}，运行实例单独持有 runId。真实流式适配层应处理取消确认、旧 runId 消息丢弃、错误恢复和任务切换；本原型定时器不能作为可靠后端实现。草稿本地保存与服务端会话状态分离。真实应用应为多窗口和存储迁移设计版本策略。

导入 `tokens.css` 后按上表拆组件；保持消息 DOM 稳定，避免原型中简化的字符串重绘。真实模型列表、用量、文件、账户和权限必须由实际服务提供，不移植示例场景为真实能力。

## 验证边界

交付检查覆盖 HTML 结构、脚本语法、设计变量一致性、无外部资源依赖，以及在轻量 DOM 测试环境中验证核心状态流转。静态检查覆盖窄屏布局规则和输入固定区域。

真实浏览器的逐像素布局、系统软键盘、剪贴板授权与辅助技术体验仍需在正式 React 集成中验收。本原型没有真实后端、真实模型、真实文件权限或连接测试。
