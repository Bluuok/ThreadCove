import type { SessionDto } from '@threadcove/shared/protocol';
import type { TransportConnectionState } from '@threadcove/shared/client';
import { connectionNames, runNames } from '../useWorkbench.ts';

type Props = {
  open: boolean;
  sessions: SessionDto[];
  selected: string;
  search: string;
  archived: boolean;
  online: boolean;
  connection: TransportConnectionState;
  submitting: boolean;
  onClose: () => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onSearch: (value: string) => void;
  onArchived: (value: boolean) => void;
  onSettings: () => void;
};

export function TaskSidebar({ open, sessions, selected, search, archived, online, connection, submitting, onClose, onCreate, onSelect, onSearch, onArchived, onSettings }: Props) {
  return <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="研究任务导航">
    <div className="index-head"><strong>ThreadCove</strong><span>LAB</span><button className="close-index" aria-label="关闭任务列表" onClick={onClose}>×</button></div>
    <button className="new-task" aria-label="新建研究任务" onClick={onCreate} disabled={!online || submitting}>新建研究 <span>＋</span></button>
    <label className="search"><span className="sr-only">搜索任务</span><input aria-label="搜索任务" placeholder="搜索研究任务…" value={search} onChange={event => onSearch(event.target.value)} /></label>
    <div className="task-tabs" aria-label="任务状态筛选">
      <button aria-pressed={!archived} className={!archived ? 'selected' : ''} onClick={() => onArchived(false)}>最近研究</button>
      <button aria-pressed={archived} className={archived ? 'selected' : ''} onClick={() => onArchived(true)}>已归档</button>
    </div>
    <nav className="task-list" aria-label="研究任务">
      {sessions.map(session => <button key={session.id} className={`task ${session.id === selected ? 'active' : ''}`} aria-current={session.id === selected ? 'page' : undefined} onClick={() => onSelect(session.id)}>
        <strong>{session.name || session.preview || '未命名研究'}</strong>
        <small><span>{session.isProcessing ? '生成中' : runNames[session.lastRun?.status ?? ''] ?? '准备开始'}</span><span>{session.isProcessing ? '●' : new Date(session.lastUsedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span></small>
      </button>)}
      {!sessions.length && <p className="sidebar-empty">{search ? '没有找到相关任务。' : archived ? '还没有归档的研究。' : '从一条新线索开始。'}</p>}
    </nav>
    <div className="sidebar-bottom"><div className="connection"><i className={online ? 'online' : ''} /><span>{connectionNames[connection]}</span></div><p>内容保存在本地工作区</p><button aria-label="工作台设置" onClick={onSettings}>工作台设置 ↗</button></div>
  </aside>;
}
