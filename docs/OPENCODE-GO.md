# OpenCode Go 与 Pi SDK

ThreadCove 使用 Pi SDK 作为 Agent 后端，通过 OpenCode Go 调用 `deepseek-v4.1-flash`，不运行本地模型。

官方 API Base URL 是 `https://opencode.ai/zen/go/v1`。客户端使用自己的 `User-Agent` 和每个会话稳定的 `x-opencode-session`。参见 [OpenCode Go 文档](https://opencode.ai/docs/go/)。

## 本机配置

PowerShell 7 中，在项目根目录执行：

```powershell
Read-Host 'OpenCode Go API key' -MaskInput | bun scripts/configure-opencode-go.ts
bun run dev:electron
```

配置脚本先发送一次最小真实 API 请求，成功后将密钥存入 `~/.threadcove/opencode-go.credentials.enc`，使用项目的加密凭据存储。密钥不写入仓库、模型消息、前端 RPC 或 SDK 的 auth.json。`THREADCOVE_HOME` 可指定本机应用数据目录。

存在这份专用配置且没有显式 `THREADCOVE_PROVIDER` 时，新任务默认使用 Pi + OpenCode Go。任务保存各自的后端与 API 上游；旧 Claude Pi 任务继续使用 Anthropic 凭据。验证新连接时请新建任务。

也可以由进程管理器注入以下环境变量。密钥通过它的秘密变量功能提供，不要填写到已跟踪文件。

```dotenv
THREADCOVE_PROVIDER=pi
THREADCOVE_PI_PROVIDER=opencode-go
THREADCOVE_MODEL=deepseek-v4.1-flash
OPENCODE_GO_API_KEY=
```

## 验证方法

`bun test` 使用本地固定响应测试服务，验证可重复的协议、SDK 行为及故障处理，不消耗 API 额度。

真实接入检查需要本机已完成上述配置及浏览器依赖：

```powershell
bun run build
bun scripts/verify-opencode-go.ts
```

该脚本会消耗少量 API 额度。它使用临时工作区，检查真实 Pi SDK 流式输出、宿主工具往返，以及浏览器经 ThreadCove 后端得到真实模型回答。不会将项目代码发送给模型。结果和截图输出到忽略跟踪的 `artifacts/qa/opencode-go/`。

## 能力边界

- [Pi 官方模型信息](https://pi.dev/models/opencode-go/deepseek-v4-1-flash) 标注上下文为 1,000,000 tokens；模型配置按此填写。短请求成功不代表已经实测完整 1M 窗口。
- API 负责模型推理；应用现已注册搜索、公开网页读取及子任务编排，见[研究工具说明](RESEARCH-TOOLS.md)。这些能力由宿主执行，不依赖 Go 转发服务端搜索。
- 默认不启用 Pi 的文件、Shell 或自动发现的扩展工具。`verify-opencode-go.ts` 检查通用工具往返；`verify-research.ts` 单独验证真实搜索、子任务及 Web/Electron 完整链路。
- 独立真实验证脚本不属于 CI，不应在自动测试中读取个人密钥或发起付费请求。
