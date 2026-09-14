import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentEvent, StoredMessage } from '@threadcove/core/types';
import type { SessionDto, SourceDto } from '@threadcove/shared/protocol';
import type { ElectronAPI, TransportConnectionState } from '@threadcove/shared/client';

export const connectionNames: Record<TransportConnectionState, string> = { idle: '等待连接', connecting: '正在连接', connected: '已连接', reconnecting: '正在重连', disconnected: '已断开', failed: '连接失败' };
export const runNames: Record<string, string> = { running: '研究中', completed: '已完成', failed: '执行失败', cancelled: '已停止', interrupted: '执行已中断' };

type RunEvent = { type: 'run_status'; status: string; error?: string; runId: string };
type Incoming = { workspaceId?: string; sessionId: string; event: AgentEvent | RunEvent | { type: 'user_message'; message: StoredMessage } };

export function useWorkbench(api: ElectronAPI) {
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
  const fileSequence = useRef(0);
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
    fileSequence.current++;
    setMessages([]); setError(''); setActivity([]); setPermission(undefined); setFilePreview(undefined);
    setFiles([]); setSources([]);
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
  async function openFile(name: string) {
    const requestWorkspace = workspace;
    const requestSession = selected;
    const sequence = ++fileSequence.current;
    const isCurrent = () => mounted.current && workspaceRef.current === requestWorkspace
      && selectedRef.current === requestSession && fileSequence.current === sequence;
    setFilePreview(undefined);
    try {
      const result = await api.readFile(requestWorkspace, requestSession, name);
      if (isCurrent()) setFilePreview({ name, content: result.content });
    } catch (error) { if (isCurrent()) report(error); }
  }
  async function saveModel() {
    try {
      await api.setModel(workspace, selected, model.trim());
      await refresh();
      setSettings(false);
    } catch (error) { report(error); }
  }
  async function respondPermission(allow: boolean) {
    if (!permission) return;
    try {
      await api.respondToPermission(workspace, selected, permission.requestId, allow);
      setPermission(undefined);
    } catch (error) { report(error); }
  }
  async function cancel() {
    try { await api.cancelProcessing(workspace, selected); } catch (error) { report(error); }
  }

  const visible = sessions.filter(session => Boolean(session.isArchived) === archived && `${session.name ?? ''} ${session.preview ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return {
    connection, workspace, selected, messages, draft, search, archived, details, sidebar, settings,
    compact, model, error, submitting, sources, files, filePreview, activity, permission,
    scroll, stick, active, busy, online, visible, report, refresh, updateDraft, createTask, send, archive,
    openFile, saveModel, respondPermission, cancel,
    setSelected, setSearch, setArchived, setDetails, setSidebar, setSettings, setModel, setError,
    setFilePreview, setPermission,
  };
}
