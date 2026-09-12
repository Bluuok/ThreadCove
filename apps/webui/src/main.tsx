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
  return <main className="connect-page"><div className="connect-brand">≈ <span>ThreadCove</span></div><section className="connect-card"><div className="eyebrow">YOUR RESEARCH, WITHIN REACH</div><h1>让思考，重新靠岸。</h1><p>连接你的研究工作区，继续上次的探索。</p><form onSubmit={event => { event.preventDefault(); void connect(); }}><label>服务地址<input required aria-label="服务地址" value={server} onChange={event => setServer(event.target.value)} /></label><label>连接令牌<input required type="password" autoComplete="off" aria-label="连接令牌" value={token} onChange={event => setToken(event.target.value)} placeholder="粘贴本地服务提供的令牌"/></label>{error && <div className="error-banner" role="alert">{error}</div>}<button className="send-button" disabled={connecting}>{connecting ? '正在连接…' : '进入工作区'} <span>→</span></button></form><details><summary>如何获取连接信息？</summary><p>在项目目录运行 <code>bun run server:headless</code>，打开终端输出的 WebUI 链接。令牌仅保存在当前浏览器会话中。</p></details></section><footer>独立任务 · 实时对话 · 本地保存</footer></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
