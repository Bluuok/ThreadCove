# 评审整改与验收

本次以 `9dd1341` 为基线，落实关联聊天中的后端可靠性、安全与前端入口问题。改动同时覆盖 Electron 和响应式 Web，共享 React 工作台与传输客户端。

## 整改对应关系

| 范围 | 最终行为 | 验证 |
| --- | --- | --- |
| BE01 文件边界 | 文件 RPC 只访问会话 `data/`，拒绝穿越、绝对路径、Windows 保留名及符号链接/目录连接；连接绑定工作区 | reliability、transport-security |
| BE02 持久化 | 按工作区与会话隔离队列，串行读改写；临时文件同步后 rename，失败保留旧文件并向调用方报错；删除等待写入完成 | sessions、reliability、review-regressions |
| BE03 流式与取消 | DeepSeek 首段实时发送，AbortSignal 终止请求；取消保留已有文本；完成、错误与工具事件落盘 | reliability、run-lifecycle、UI 验收 |
| BE04 提交生命周期 | 同步预留任务，提前返回 accepted/runId；requestId 幂等；忙碌拒绝不留下幽灵消息；启动恢复中断状态 | run-lifecycle |
| BE05 历史恢复 | DeepSeek 恢复有限长度历史；Claude 使用有界文本历史桥接；流式消息有稳定 ID 和累计快照，重连后补齐文本 | reliability、review-regressions、transcript-identity、UI 重启验证 |
| BE06 配置生效 | provider/model 从运行时配置进入真实请求；任务模型持久保存，运行期间禁止冲突修改 | reliability、UI 模型与重启验证 |
| FE01 桌面入口 | Electron 主进程启动运行时，隔离 preload 暴露 API，renderer 使用共享工作台；允许明确的 `file://` Origin | 实际 Electron 窗口验收 |
| FE02 Web 入口 | Vite 页面、连接表单、fragment 引导凭据、响应式任务与详情抽屉 | Chromium 桌面与 390px 验收 |
| FE03 客户端生命周期 | 共享客户端 ready/dispose、鉴权失败停止重试、握手与请求超时、有界重连、远端明文 WS 拒绝 | bootstrap、transport-security |

## 可复现验证

```sh
bun install
bun test
bun run typecheck
bun run lint
bun run build
# UI 验证还需要 Node.js 与 Playwright Chromium；首次安装浏览器：
bunx playwright install chromium
bun run test:ui
```

Windows 本次结果：135 个测试通过，5 个需要真实 DeepSeek 密钥的测试跳过；类型检查、lint、Web/Electron 构建通过。`scripts/verify-ui.cjs` 使用本地 SSE 测试服务，通过真实 Web 与 Electron 界面验证创建、发送、停止、重载、模型切换、服务重启历史与移动端首屏。截图和结构化结果写入被 Git 忽略的 `artifacts/qa/`。

独立审查使用 Codex 原生 Astra 代理，基于真实 diff；发现的草稿覆盖、重连文本重复/遗漏、删除写入竞争和 Claude 历史恢复问题均已修复并复核。没有使用未核实的外部 Claude/Gemini 路线。

## 数据兼容与边界

- 保留原有 JSONL 格式，新增字段可选，无批量迁移。文件 RPC 的相对路径现在以 `sessions/<id>/data/` 为根；旧调用若要访问产物，需将产物放在该目录。会话 JSONL 不通过文件 RPC 暴露。
- 首段及约 750ms 间隔保存流式检查点，正常完成、取消、关闭时刷新；进程强制中止可能丢失最近一个检查点之后的内容。重启将残留 running 标为 interrupted。
- 累计文本快照用于修复断线期间缺段，会增加长回复的传输量。当前运行时面向单进程本地使用，不提供跨进程存储锁或分布式恢复。
- 真实 DeepSeek/Claude 外部 API 本次未验证。Claude 恢复的是文本上下文，不是 SDK 原生 resume。Pi 子进程协议测试通过，但真实 SDK 执行仍是未完成的既有实现，不能据此宣称 Pi 可用于生产研究。
- 来源与文件面板展示已有数据；本次没有新增来源配置向导、完整研究调度器或虚构搜索结果。Web 文件选择明确报不支持。
- 服务默认只监听 loopback，随机 token 且校验 Origin；远程部署仍需单独配置 TLS 与部署边界。
