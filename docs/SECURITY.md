# ThreadCove 安全说明

个人项目的工程实践风格——这里写清楚三个安全相关的设计决策与动机。

## 1. 凭据加密模型（AES-256-GCM + 机器绑定）

凭据库位于 `~/.threadcove/credentials.enc`，格式：

```text
[Header - 64 字节]
├── Magic: "TC01\0\0\0" (8B)
├── Flags: uint32 LE (4B)
├── Salt: 32B（PBKDF2 盐，每文件随机生成）
└── Reserved: 20B
[Encrypted Payload]
├── IV: 12B（每次写入随机）
├── Auth Tag: 16B（GCM 认证标签）
└── Ciphertext: AES-256-GCM 加密的 JSON
```

**密钥派生**：`PBKDF2-HMAC-SHA256(机器标识, salt, 100000 轮, 32B)`。
机器标识取 OS 硬件 ID（macOS `IOPlatformUUID` / Windows `MachineGuid` / Linux `machine-id`）。

⚠️ **口径**：机器标识是**密钥派生的输入**（配合随机盐经 PBKDF2 多轮运算），不是密钥本身。
把 `credentials.enc` 拷到另一台机器解不开，是因为 KDF 输入不同导致 GCM 认证失败——
机器绑定防的是「文件被拷走后离线爆破」，不是「同机管理员」。

**边界**：这是个人工程的合理强度。不替代 OS 级 keychain/credential vault 的硬件防护，
也不防运行中进程的内存读取。

## 2. 明文 ws:// 拒绝

客户端（preload bootstrap 与 WebUI adapter 共用同一校验）对非 localhost 地址的
`ws://` 连接直接抛错：

```
Refusing to connect to a remote server over unencrypted ws://.
Use wss:// (TLS) for non-localhost connections.
```

动机：握手 token 走明文等于把凭据贴在局域网上。localhost 例外是因为
loopback 流量不出本机，且本地服务令牌经 IPC 引导注入、生命周期与进程一致。

## 3. preload 无手工 IPC 面

preload 只有引导逻辑：构造 `WsRpcClient`/`RoutedClient`，经 `buildClientApi(CHANNEL_MAP)`
生成渲染进程 API。没有任何手写的 `ipcRenderer.invoke` 分发表——

- 通道分类由 routing 穷举测试在 CI 强制，新增通道必须显式决策 LOCAL_ONLY / REMOTE_ELIGIBLE
- 渲染进程无法调用任何未在 `CHANNEL_MAP` 声明的通道
- `contextIsolation: true` + `nodeIntegration: false`

## 4. 凭据的进程边界

- MCP/API 源凭据只存在于**宿主进程**（Electron 主 / headless server）
- Pi 子进程遇到源工具时发 `tool_execute_request` 回宿主执行，结果经
  `tool_execute_response` 返回——**凭据永不进入子进程环境**
- 凭据值不进日志、不进 RPC 负载、不进错误消息

## 5. 已知边界（诚实交底）

- 无多用户/行级权限——文件系统级隔离，行级需上层 DB/RLS
- WS 服务当前面向本机场景；远程暴露依赖 wss + token，未做速率限制/审计
- OAuth 完整授权流程未实现：凭据手动粘贴录入，token 获取只留 `getToken` 钩子
