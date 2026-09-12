import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, StoredMessage } from '@threadcove/core/types';
import type { SessionDto, SourceDto } from '@threadcove/shared/protocol';
import type { ElectronAPI, TransportConnectionState } from '@threadcove/shared/client';
import './workbench.css';
import { useOverlayFocus } from './useOverlayFocus.ts';

const connectionNames: Record<TransportConnectionState, string> = { idle: '等待连接', connecting: '正在连接', connected: '已连接', reconnecting: '正在重连', disconnected: '已断开', failed: '连接失败' };
const runNames: Record<string, string> = { running: '研究中', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '执行已中断' };
type RunEvent = { type: 'run_status'; status: string; error?: string; runId: string };
type Incoming = { workspaceId?: string; sessionId: string; event: AgentEvent | RunEvent | { type: 'user_message'; message: StoredMessage } };

export function Workbench({ api, onDisconnect }: { api: ElectronAPI; onDisconnect?: () => void }) {
  const [connection, setConnection] = useState(api.getConnectionState());
  const [workspace, setWorkspace] = useState('');
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [selected, setSelected] = useState('');
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [details, setDetails] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [settings, setSettings] = useState(false);
  const [compact, setCompact] = useState(window.matchMedia('(max-width:1200px)').matches);
  const [model, setModel] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [files, setFiles] = useState<Array<{ name: string; type: string }>>([]);
  const [filePreview, setFilePreview] = useState<{ name: string; content: string }>();
  const [activity, setActivity] = useState<string[]>([]);
  const [permission, setPermission] = useState<Extract<AgentEvent, { type: 'permission_request' }>['request']>();
  const liveId = useRef<string>();
  const loadSequence = useRef(0);
  const selectedRef = useRef(selected);
  const workspaceRef = useRef(workspace);
  const revision = useRef(0);
  const pending = useRef<{ session: string; text: string; id: string }>();
  const scroll = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const mounted = useRef(true);
  const active = sessions.find(session => session.id === selected);
  const busy = submitting || Boolean(active?.isProcessing);
  const online = connection === 'connected';
  const closeOverlay = useCallback(() => { setSettings(false); setSidebar(false); setDetails(false); }, []);
  useOverlayFocus(settings ? '.settings-modal' : sidebar ? '.sidebar' : details && compact ? '.details-panel' : undefined, closeOverlay);
  useEffect(() => {
    const media = window.matchMedia('(max-width:1200px)');
    const change = () => setCompact(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const report = useCallback((value: unknown) => { if (mounted.current) setError(value instanceof Error ? value.message : String(value)); }, []);
  const refresh = useCallback(async (id = workspaceRef.current) => {
    if (!id) return;
    const result = await api.getSessions(id, true);
    if (mounted.current) setSessions(result);
  }, [api]);
  const loadMessages = useCallback(async (id: string) => {
    const before = revision.current;
    const sequence = ++loadSequence.current;
    const result = await api.getSessionMessages(workspaceRef.current, id) as StoredMessage[];
    if (mounted.current && selectedRef.current === id && sequence === loadSequence.current) {
      if (before === revision.current) setMessages(result);
      else setTimeout(() => { if (mounted.current && selectedRef.current === id && sequence === loadSequence.current) void loadMessages(id).catch(report); }, 120);
    }
  }, [api, report]);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    const load = async () => {
      const workspaces = await api.getWorkspaces();
      const first = workspaces[0];
      if (stopped || !first) return;
      workspaceRef.current = first.id; setWorkspace(first.id);
      const result = await api.getSessions(first.id, true);
      if (stopped) return;
      setSessions(result);
      if (!selectedRef.current) setSelected(result.find(session => !session.isArchived)?.id ?? '');
      else await loadMessages(selectedRef.current);
    };
    const off = api.onConnectionStateChanged(state => { setConnection(state); if (state === 'connected') void load().catch(report); });
    const offEvents = api.onSessionEvent(raw => {
      const { sessionId, event } = raw as Incoming;
      if (event.type === 'user_message') {
        setSessions(current => current.map(session => session.id === sessionId ? { ...session, isProcessing: true } : session));
      }
      if (event.type === 'run_status') {
        setSessions(current => current.map(session => session.id === sessionId ? { ...session, isProcessing: event.status === 'running' } : session));
        void refresh().catch(report);
      }
      if (sessionId !== selectedRef.current) return;
      revision.current++;
      if (event.type === 'user_message') {
        setMessages(current => current.some(message => message.id === event.message.id) ? current : [...current, event.message]);
        setActivity([]); setError('');
      } else if (event.type === 'text_delta' || event.type === 'text_complete') {
        const id = event.messageId ?? liveId.current ?? `live-${crypto.randomUUID()}`;
        liveId.current = event.type === 'text_complete' ? undefined : id;
        setMessages(current => {
          const index = current.findIndex(message => message.id === id);
          const previous = current[index];
          const next: StoredMessage = { id, type: 'assistant', content: event.type === 'text_complete' ? event.text : event.textSnapshot ?? (previous?.content ?? '') + event.text, timestamp: previous?.timestamp ?? Date.now(), turnId: event.turnId };
          return index === -1 ? [...current, next] : current.map((message, i) => i === index ? next : message);
        });
      } else if (event.type === 'run_status') {
        setPermission(undefined);
        if (event.error) setError(event.error);
        void loadMessages(sessionId).catch(report);
      } else if (event.type === 'typed_error') setError(event.error.message);
      else if (event.type === 'error') setError(event.message);
      else if (event.type === 'permission_request') { setPermission(event.request); setDetails(true); }
      else if (event.type === 'tool_start' || event.type === 'tool_result') setActivity(current => [...current.slice(-29), `${event.type === 'tool_start' ? '正在执行' : '已返回'} · ${event.toolName}`]);
    });
    void api.ready().then(load).catch(report);
    return () => { stopped = true; mounted.current = false; off(); offEvents(); };
  }, [api, loadMessages, refresh, report]);

  useEffect(() => {
    selectedRef.current = selected;
    liveId.current = undefined;
    revision.current++;
    setMessages([]); setError(''); setActivity([]); setPermission(undefined); setFilePreview(undefined);
    setDraft(sessionStorage.getItem(`threadcove-draft:${workspace}:${selected}`) ?? '');
    stick.current = true;
    if (selected && workspace) void loadMessages(selected).catch(report);
  }, [selected, workspace, loadMessages, report]);
  useEffect(() => { if (active?.model) setModel(active.model); }, [active?.model]);
  useEffect(() => {
    if (stick.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!details || !workspace || !selected || !online) return;
    let cancelled = false;
    void Promise.all([api.getSources(workspace), api.listFiles(workspace, selected)]).then(([sourceList, fileList]) => {
      if (!cancelled) { setSources(sourceList); setFiles(fileList.entries as Array<{ name: string; type: string }>); }
    }).catch(report);
    return () => { cancelled = true; };
  }, [api, details, workspace, selected, online, active?.isProcessing, report]);

  function updateDraft(value: string) {
    setDraft(value); sessionStorage.setItem(`threadcove-draft:${workspace}:${selected}`, value);
  }
  async function createTask() {
    if (!online || !workspace || submitting) return;
    setSubmitting(true); setError('');
    try { const session = await api.createSession(workspace); await refresh(); setSelected(session.id); setSidebar(false); }
    catch (error) { report(error); } finally { setSubmitting(false); }
  }
  async function send() {
    const text = draft.trim();
    if (!text || busy || !online) return;
    const submissionWorkspace = workspace;
    const originalSession = selected;
    let submissionSession = selected;
    setSubmitting(true); setError(''); stick.current = true;
    try {
      if (!submissionSession) {
        const session = await api.createSession(submissionWorkspace);
        submissionSession = session.id;
        if (selectedRef.current === originalSession) { selectedRef.current = submissionSession; setSelected(submissionSession); }
      }
      if (!pending.current || pending.current.session !== submissionSession || pending.current.text !== text) pending.current = { session: submissionSession, text, id: crypto.randomUUID() };
      const result = await api.sendMessage(submissionWorkspace, submissionSession, text, pending.current.id);
      if (!result.accepted) throw new Error('消息未被接受，请重试');
      pending.current = undefined;
      if (selectedRef.current === submissionSession) setDraft('');
      sessionStorage.removeItem(`threadcove-draft:${submissionWorkspace}:${originalSession}`);
      sessionStorage.removeItem(`threadcove-draft:${submissionWorkspace}:${submissionSession}`);
      await refresh();
    } catch (error) {
      sessionStorage.setItem(`threadcove-draft:${submissionWorkspace}:${submissionSession}`, text);
      if (selectedRef.current === submissionSession) { setDraft(text); report(error); }
    } finally { setSubmitting(false); }
  }
  async function archive() {
    if (!active || busy) return;
    try { await api.archiveSession(workspace, selected, !active.isArchived); await refresh(); setSelected(''); } catch (error) { report(error); }
  }
  const visible = sessions.filter(session => Boolean(session.isArchived) === archived && `${session.name ?? ''} ${session.preview ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={`workbench ${details ? 'with-details' : ''}`}>
    {sidebar && <button className="scrim" aria-label="关闭任务列表" onClick={() => setSidebar(false)} />}
    <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
      <button className="mobile-close icon-button" aria-label="关闭任务导航" onClick={() => setSidebar(false)}>×</button>
      <a className="brand" href="#" onClick={event => event.preventDefault()}><span className="brand-mark">≈</span><span>ThreadCove<small>留住线索，让思考靠岸</small></span></a>
      <button className="new-task" onClick={() => void createTask()} disabled={!online || submitting}><span>＋</span> 新建研究任务</button>
      <label className="search"><span>⌕</span><input aria-label="搜索任务" placeholder="搜索你的研究" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="task-tabs"><button className={!archived ? 'selected' : ''} onClick={() => setArchived(false)}>进行与最近</button><button className={archived ? 'selected' : ''} onClick={() => setArchived(true)}>已归档</button></div>
      <nav className="task-list" aria-label="研究任务">{visible.map(session => <button key={session.id} className={`task ${session.id === selected ? 'active' : ''}`} onClick={() => { setSelected(session.id); setSidebar(false); }}>
        <span className={`task-dot ${session.isProcessing ? 'working' : ''}`} /><span><strong>{session.name || session.preview || '未命名研究'}</strong><small>{session.isProcessing ? '正在研究…' : runNames[session.lastRun?.status ?? ''] ?? '准备开始'}<span>{new Date(session.lastUsedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span></small></span>
      </button>)}{!visible.length && <p className="sidebar-empty">{search ? '没有找到相关任务' : archived ? '还没有归档的研究' : '从一个好问题开始。'}</p>}</nav>
      <div className="sidebar-bottom"><div className="connection"><i className={online ? 'online' : ''} />{connectionNames[connection]}<span>本地工作区</span></div><button onClick={() => setSettings(true)}>⚙ <span>工作台设置</span><span>↗</span></button></div>
    </aside>
    <main className="main-panel">
      <header className="workspace-header"><button className="mobile-menu icon-button" aria-label="打开任务列表" onClick={() => setSidebar(true)}>☰</button><div className="breadcrumb">我的工作区 <span>/</span> 研究手记</div><div className="header-actions"><span className="local-badge">● 私人研究空间</span><button className="icon-button" aria-label="工作台设置" onClick={() => setSettings(true)}>⚙</button></div></header>
      <div className="task-heading"><div><div className="eyebrow">RESEARCH WORKSPACE</div><h1>{active?.name || active?.preview || '下一段洞见，从这里开始'}</h1><p>{active ? (runNames[active.lastRun?.status ?? ''] ?? '准备开始') + ' · ' + (active.model ?? '默认模型') : '把值得追问的问题，变成有迹可循的研究。'}</p></div><div className="task-actions">{active && <button className="quiet-button" disabled={busy || !online} onClick={() => void archive()}>{active.isArchived ? '取消归档' : '归档'}</button>}<button className={`quiet-button ${details ? 'pressed' : ''}`} aria-expanded={details} onClick={() => setDetails(!details)}>执行详情 <span>☷</span></button></div></div>
      <div className="conversation" ref={scroll} onScroll={() => { const node = scroll.current; if (node) stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
        {!messages.length && <section className="empty-state"><div className="cove-art" aria-hidden="true"><div className="sun"/><div className="wave wave-one"/><div className="wave wave-two"/><div className="wave wave-three"/></div><div className="eyebrow">A QUIET PLACE FOR BIG QUESTIONS</div><h2>给好奇心，一个安静的港湾。</h2><p>梳理一个领域，比较几种选择，或深入一个还没有答案的问题。<br/>每段对话独立保存，随时回来接着想。</p><div className="suggestions">{['帮我梳理一个研究主题', '比较几种方案的优缺点', '分析我提供的资料'].map((text, index) => <button key={text} onClick={() => updateDraft(['我想研究这个主题：', '请比较以下方案，说明各自的优缺点：', '请分析以下资料，整理关键观点与待核实的问题：'][index]!)}><span>{['↗', '⇄', '≡'][index]}</span>{text}<b>→</b></button>)}</div><small>从你的问题开始。模型的回答需要结合资料核实。</small></section>}
        {messages.map(message => <article key={message.id} className={`message message-${message.type}`}><div className="message-avatar">{message.type === 'user' ? '你' : message.type === 'assistant' ? '≈' : '·'}</div><div className="message-body"><div className="message-meta"><strong>{message.type === 'user' ? '你' : message.type === 'assistant' ? 'ThreadCove' : message.type === 'tool' ? message.toolName || '工具结果' : '执行信息'}</strong><time>{new Date(message.timestamp ?? 0).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div><div className="message-content">{message.content}</div>{message.type === 'assistant' && <button className="copy-button" onClick={() => void navigator.clipboard.writeText(message.content).catch(report)}>复制文本</button>}</div></article>)}
        {active?.isProcessing && <div className="generating" role="status"><i/> 正在研究，新的内容会在这里出现…</div>}
      </div>
      <div className="composer-area">{error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="关闭提示" onClick={() => setError('')}>×</button></div>}{active?.lastRun?.status === 'interrupted' && <div className="notice">上次执行因服务退出而中断。已保存的内容保留在这里，你可以继续追问。</div>}
        {permission && <div className="notice permission"><span>{permission.description}</span><button onClick={() => void api.respondToPermission(workspace, selected, permission.requestId, false).then(() => setPermission(undefined)).catch(report)}>拒绝</button><button onClick={() => void api.respondToPermission(workspace, selected, permission.requestId, true).then(() => setPermission(undefined)).catch(report)}>允许这次</button></div>}
        <form className={`composer ${busy ? 'is-busy' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }}><textarea aria-label="研究问题" placeholder={online ? '提出问题，或继续追问…' : '连接就绪后，即可开始研究'} value={draft} onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} rows={2}/><div className="composer-tools"><button type="button" className="model-button" onClick={() => setSettings(true)}>✧ {active?.model || '默认模型'} <span>⌄</span></button>{busy ? <button className="send-button stop" type="button" disabled={!online || submitting} onClick={() => void api.cancelProcessing(workspace, selected).catch(report)}>■ 停止</button> : <button className="send-button" type="submit" disabled={!online || !workspace || !draft.trim()}>开始研究 <span>↑</span></button>}</div></form><div className="composer-footnote"><span>{online ? '内容保存在当前工作区' : connectionNames[connection]}</span><span>Enter 发送 · Shift + Enter 换行</span></div>
      </div>
    </main>
    {details && <aside className="details-panel"><header><div><div className="eyebrow">RESEARCH CONTEXT</div><h2>研究详情</h2></div><button className="icon-button" aria-label="关闭执行详情" onClick={() => setDetails(false)}>×</button></header><section><h3>执行状态 <span>01</span></h3><div className="detail-status"><i className={active?.isProcessing ? 'working' : ''}/>{active?.isProcessing ? '正在研究' : runNames[active?.lastRun?.status ?? ''] ?? '等待你的问题'}</div><p>结果保存在独立任务中，可随时回来继续。</p></section><section><h3>资料源 <span>{String(sources.length).padStart(2, '0')}</span></h3>{sources.map(source => <div className="detail-row" key={source.slug}>{source.name}<small>{source.enabled ? '已配置' : '已停用'}</small></div>)}{!sources.length && <p>尚未配置资料源。当前模型根据你的问题与对话内容作答。</p>}</section><section><h3>任务文件 <span>{String(files.length).padStart(2, '0')}</span></h3>{files.map(file => <button className="file-row" key={file.name} disabled={file.type === 'directory'} onClick={() => void api.readFile(workspace, selected, file.name).then(result => setFilePreview({ name: file.name, content: result.content })).catch(report)}>▤ {file.name}</button>)}{!files.length && <p>任务的资料目录中还没有文件。</p>}{filePreview && <div className="file-preview"><strong>{filePreview.name}</strong><pre>{filePreview.content}</pre></div>}</section><section><h3>本次执行 <span>↗</span></h3>{activity.map((item, i) => <p key={i} className="activity">{item}</p>)}{!activity.length && <p>工具调用发生时，会在这里显示。</p>}</section><div className="details-note">让线索有序，让思考自由。<span>ThreadCove · Research thoughtfully.</span></div></aside>}
    {settings && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setSettings(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title"><button className="modal-close icon-button" autoFocus aria-label="关闭设置" onClick={() => setSettings(false)}>×</button><div className="eyebrow">YOUR WORKSPACE</div><h2 id="settings-title">工作台设置</h2><p>当前连接：{connectionNames[connection]}</p>{active ? <form onSubmit={event => { event.preventDefault(); void api.setModel(workspace, selected, model.trim()).then(async () => { await refresh(); setSettings(false); }).catch(report); }}><label>此任务使用的模型<input value={model} onChange={event => setModel(event.target.value)} placeholder="模型 ID" /></label><p className="settings-help">使用当前服务 Provider 支持的模型。执行结束后可切换。</p><button className="send-button" disabled={busy || !online || !model.trim()}>保存模型</button></form> : <p>新建任务后，可以为该任务选择模型。</p>}<p className="settings-help">模型凭据由本地服务读取。缺少配置时，界面会显示具体错误。</p>{onDisconnect && <button className="quiet-button" onClick={onDisconnect}>更换连接</button>}{error && <div role="alert" className="error-banner">{error}</div>}</section></div>}
  </div>;
}
