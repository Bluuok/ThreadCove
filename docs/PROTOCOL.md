# ThreadCove 传输协议

R12 统一传输层的线格式与通道分类——同一套 RPC 服务 Electron 桌面端与 WebUI。

## Envelope

所有消息（请求/响应/推送/握手）共用一个 envelope，JSON 序列化：

```typescript
interface MessageEnvelope {
  id: string;                  // 关联 ID：请求生成 UUID，响应原样回传
  type: MessageType;           // 'handshake' | 'handshake_ack' | 'request' | 'response' | 'event' | 'error'
  channel?: string;            // request / event 必填
  args?: unknown[];            // 请求参数或事件负载
  result?: unknown;            // 响应负载
  error?: WireError;           // 结构化错误 { code, message, data? }
  protocolVersion?: string;    // 握手用，当前 '1.0'
  token?: string;              // 远程握手鉴权
  workspaceId?: string;        // 客户端声明的活动工作区
  clientId?: string;           // 服务端在 handshake_ack 中分配
  registeredChannels?: string[]; // 服务端已注册通道，客户端可据此降级
}
```

### 二进制标注编码

`Uint8Array` 在 JSON 中以 base64 标注对象传输，解码端还原为 `Uint8Array`：

```json
{ "__tcRpcType": "u8", "base64": "AAEC+v8=" }
```

### 错误码

`HANDLER_ERROR` · `CHANNEL_NOT_FOUND` · `AUTH_FAILED` · `PROTOCOL_VERSION_UNSUPPORTED` · `REQUEST_TIMEOUT`

类标识不跨线传输——接收端**必须**按 `err.code` 分支，不得 `instanceof`。

## 握手

```text
client → { type: 'handshake', protocolVersion, token?, workspaceId? }
server → { type: 'handshake_ack', clientId, protocolVersion, registeredChannels }
       | { type: 'error', error: { code: 'AUTH_FAILED' | 'PROTOCOL_VERSION_UNSUPPORTED' } }
```

握手前仅接受 `handshake`；鉴权失败或协议版本不匹配即断开。

## 通道分类（routing 穷举）

每条通道必须归其一，**穷举测试强制分类**（`packages/shared/tests/routing.test.ts`），未分类通道直接 CI 红。

### LOCAL_ONLY（需要本地 OS/Electron）

| 通道 | 说明 |
| --- | --- |
| `dialog:openFile` | 原生文件对话框 |
| `system:getVersions` | 本机信息 |
| `system:openExternal` | shell.openExternal |

### REMOTE_ELIGIBLE（跟工作区走）

| 命名空间 | 通道 |
| --- | --- |
| server | `server:getStatus` · `server:getWorkspaces` |
| sessions | `sessions:get` · `sessions:create` · `sessions:delete` · `sessions:archive` · `sessions:flag` · `sessions:getMessages` · `sessions:sendMessage` · `sessions:cancel` · `sessions:setModel` · `sessions:getModel` · `sessions:respondToPermission` · `sessions:retryLast` · `session:event`（推送） |
| workspaces | `workspaces:get` · `workspaces:create` · `workspaces:getDefaults` · `workspaces:setWorkingDirectory` |
| sources | `sources:list` · `sources:create` · `sources:delete` · `sources:setCredential` · `sources:getTools` · `sources:changed`（推送） |
| files | `files:list` · `files:read` · `files:write` |

### 事件推送

`session:event` 负载为 `{ sessionId, event }`，其中 `event` 是 R10 定义的
`AgentEvent` 可辨识联合——R10 定义事件形状，R12 负责搬运到多端。

## 双客户端路由

```text
invoke(channel)
  ├─ channel ∈ LOCAL_ONLY      → 本地 WsRpcClient（Electron 主进程内嵌服务）
  └─ channel ∈ REMOTE_ELIGIBLE → workspaceClient（本地或远程，随工作区切换）
```

桌面端与 WebUI 共用同一 `WsRpcClient` + `buildClientApi` + `CHANNEL_MAP`；
WebUI 只覆写 LOCAL_ONLY 方法（对话框 → `input[type=file]`，openExternal → `window.open`）。

## 安全

- 非 localhost 的明文 `ws://` 一律拒绝（token 明文防护），远程必须 `wss://`
- 本地绑定 `127.0.0.1`，令牌仅经本地 IPC 引导传递，凭据值永不过线
