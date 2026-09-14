import type { AgentEvent } from '@threadcove/core/types';
import type { SessionDto, SourceDto } from '@threadcove/shared/protocol';
import { runNames } from '../useWorkbench.ts';

type Permission = Extract<AgentEvent, { type: 'permission_request' }>['request'];
type Props = {
  active?: SessionDto;
  sources: SourceDto[];
  files: Array<{ name: string; type: string }>;
  filePreview?: { name: string; content: string };
  activity: string[];
  permission?: Permission;
  onClose: () => void;
  onOpenFile: (name: string) => void;
  onPermission: (allow: boolean) => void;
};

export function DetailsPanel({ active, sources, files, filePreview, activity, permission, onClose, onOpenFile, onPermission }: Props) {
  return <aside className="details-panel" aria-label="资料与执行"><header><div><span className="mono-label">RESEARCH RECORD</span><h2>资料与执行</h2></div><button aria-label="关闭执行详情" onClick={onClose}>×</button></header>
    {permission && <section className="panel-permission"><h3>等待你的允许</h3><p>{permission.description}</p><div><button onClick={() => onPermission(false)}>拒绝</button><button className="accent-button" onClick={() => onPermission(true)}>允许这次</button></div></section>}
    <section><h3>执行记录 <span>01</span></h3><div className="detail-status"><i className={active?.isProcessing ? 'working' : ''}/>{active?.isProcessing ? '正在研究' : runNames[active?.lastRun?.status ?? ''] ?? '等待问题'}</div>{activity.map((item, index) => <p className="activity" key={`${item}-${index}`}>{item}</p>)}{!activity.length && <p>工具调用发生时，会在这里显示。</p>}</section>
    <section><h3>资料源 <span>{String(sources.length).padStart(2, '0')}</span></h3>{sources.map(source => <div className="detail-row" key={source.slug}><span>{source.name}</span><small>{source.enabled ? '已配置' : '已停用'}</small></div>)}{!sources.length && <p>尚未配置资料源。</p>}</section>
    <section><h3>任务文件 <span>{String(files.length).padStart(2, '0')}</span></h3>{files.map(file => <button className="file-row" key={file.name} disabled={file.type === 'directory'} onClick={() => onOpenFile(file.name)}><span>▤ {file.name}</span><small>{file.type === 'directory' ? '目录' : '打开 ↗'}</small></button>)}{!files.length && <p>任务资料目录中还没有文件。</p>}{filePreview && <div className="file-preview"><strong>{filePreview.name}</strong><pre>{filePreview.content}</pre></div>}</section>
  </aside>;
}
