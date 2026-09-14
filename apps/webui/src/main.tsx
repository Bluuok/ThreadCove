import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Workbench } from '@threadcove/ui';
import { createWebApi } from './adapter/web-api.ts';
import type { ElectronAPI } from '@threadcove/shared/client';
const fragment = new URLSearchParams(location.hash.slice(1));
const initial = { serverUrl: fragment.get('server') || sessionStorage.getItem('threadcove-server') || 'ws://127.0.0.1:8787', token: fragment.get('token') || sessionStorage.getItem('threadcove-token') || '' };
if (fragment.has('token')) history.replaceState(null, '', location.pathname + location.search);
function App() {
  const [server, setServer] = useState(initial.serverUrl);
  const [token, setToken] = useState(initial.token);
  const [api, setApi] = useState<ElectronAPI>();
  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);
  async function connect() {
    setConnecting(true); setError('');
    let client: ElectronAPI | undefined;
    try {
      client = createWebApi({ serverUrl: server, token });
      await client.ready();
      sessionStorage.setItem('threadcove-server', server);
      sessionStorage.setItem('threadcove-token', token);
      setApi(client);
    } catch (error) { client?.dispose(); setError(error instanceof Error ? error.message : String(error)); }
    finally { setConnecting(false); }
  }
  useEffect(() => { if (initial.token) void connect(); }, []);
  useEffect(() => () => api?.dispose(), [api]);
  if (api) return <Workbench api={api} onDisconnect={() => { api.dispose(); setApi(undefined); sessionStorage.removeItem('threadcove-token'); setToken(''); }}/>;
  return <div className="connect-shell"><aside className="connect-rail" aria-label="ThreadCove">tc.</aside><main className="connect-page"><section className="connect-card"><div className="eyebrow">FIELDNOTES LAB / LOCAL CONNECTION</div><h1>回到你的<br/>研究现场。</h1><p>连接本地服务，继续未完成的线索、资料与推演。</p><form onSubmit={event => { event.preventDefault(); void connect(); }}><label>服务地址<input required aria-label="服务地址" value={server} onChange={event => setServer(event.target.value)} /></label><label>连接令牌<input required type="password" autoComplete="off" aria-label="连接令牌" value={token} onChange={event => setToken(event.target.value)} placeholder="粘贴本地服务提供的令牌"/></label>{error && <div className="error-banner" role="alert">{error}</div>}<button className="send-button" disabled={connecting}>{connecting ? '正在连接…' : '进入研究室 ↗'}</button></form><details><summary>如何获取连接信息？</summary><p>在项目目录运行 <code>bun run server:headless</code>，打开终端输出的 WebUI 链接。令牌仅保存在当前浏览器会话中。</p></details><div className="connect-edition">PERSONAL WORKSPACE / LOCAL FIRST / CONTINUOUS NOTES</div></section></main></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
