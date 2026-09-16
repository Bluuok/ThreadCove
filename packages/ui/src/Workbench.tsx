import { useCallback } from 'react';
import type { ElectronAPI } from '@threadcove/shared/client';
import './workbench.css';
import { useOverlayFocus } from './useOverlayFocus.ts';
import { connectionNames, runNames, useWorkbench } from './useWorkbench.ts';
import { IdentityRail } from './components/IdentityRail.tsx';
import { TaskSidebar } from './components/TaskSidebar.tsx';
import { ResearchMap } from './components/ResearchMap.tsx';
import { Conversation } from './components/Conversation.tsx';
import { Composer } from './components/Composer.tsx';
import { DetailsPanel } from './components/DetailsPanel.tsx';
import { SettingsDialog } from './components/SettingsDialog.tsx';

export function Workbench({ api, onDisconnect }: { api: ElectronAPI; onDisconnect?: () => void }) {
  const vm = useWorkbench(api);
  const closeOverlay = useCallback(() => { vm.setSettings(false); vm.setSidebar(false); vm.setDetails(false); }, [vm.setDetails, vm.setSettings, vm.setSidebar]);
  useOverlayFocus(vm.settings ? '.settings-modal' : vm.sidebar ? '.sidebar' : vm.details ? '.details-panel' : undefined, closeOverlay);
  const hasConversation = vm.messages.length > 0;
  const title = vm.active?.name || vm.active?.preview || '线索起点';
  const handleScroll = () => { const node = vm.scroll.current; if (node) vm.stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; };

  return <div className={`workbench ${vm.details ? 'with-details' : ''} ${hasConversation ? 'in-chat' : ''}`}>
    <IdentityRail />
    {vm.sidebar && <button className="scrim" aria-label="关闭任务列表" onClick={() => vm.setSidebar(false)} />}
    <TaskSidebar open={vm.sidebar} sessions={vm.visible} selected={vm.selected} search={vm.search} archived={vm.archived} online={vm.online} connection={vm.connection} submitting={vm.submitting} onClose={() => vm.setSidebar(false)} onCreate={() => void vm.createTask()} onSelect={id => { vm.setSelected(id); vm.setSidebar(false); }} onSearch={vm.setSearch} onArchived={vm.setArchived} onSettings={() => vm.setSettings(true)} />
    <main className="main-panel">
      <header className="workspace-header"><div className="breadcrumb"><button className="mobile-menu" aria-label="打开任务列表" onClick={() => vm.setSidebar(true)}>☰</button><span>个人研究室</span><i>/</i><strong>{title}</strong></div><div className="header-actions"><button aria-label="执行详情" aria-expanded={vm.details} onClick={() => vm.setDetails(!vm.details)}>资料与执行 ↗</button><button aria-label="工作台设置" onClick={() => vm.setSettings(true)}>设置</button></div></header>
      <div className="workspace-body">
        {!hasConversation ? <section className="research-home"><div className="home-intro"><div><div className="eyebrow">FIELDNOTES LAB / 研究现场</div><h1>让零散线索，<br/>长成自己的洞见。</h1><p>从一个还没想清楚的问题开始。<br/>把资料、追问与推演，留在同一条研究线上。</p></div><div className="edition">PERSONAL WORKSPACE<br/>开放问题 / 持续记录<br/>────────<br/>{vm.online ? '本地工作区已连接' : connectionNames[vm.connection]}</div></div><div className="research-stage"><ResearchMap onPrompt={vm.updateDraft}/><aside className="field-note"><span>研究手记 / 001</span><h2>好问题，值得留白。</h2><p>先记录假设，再补充证据。研究不必一开始就有答案。</p><button onClick={() => vm.updateDraft('请帮我把一个宽泛的主题拆成三个可研究的问题：')}>从拆解问题开始 ↗</button></aside></div>{vm.active && <div className="active-record"><div><span>当前研究档案</span><p>{runNames[vm.active.lastRun?.status ?? ''] ?? '准备开始'} · {vm.active.model ?? '默认模型'}</p></div><button disabled={vm.busy || !vm.online} onClick={() => void vm.archive()}>{vm.active.isArchived ? '取消归档' : '归档这条线索'} ↗</button></div>}</section> : <section className="conversation-record"><header><div><div className="eyebrow">研究档案 / {runNames[vm.active?.lastRun?.status ?? ''] ?? '进行中'}</div><h1>{title}</h1></div><div><button disabled={vm.busy || !vm.online} onClick={() => void vm.archive()}>{vm.active?.isArchived ? '取消归档' : '归档'}</button></div></header><Conversation messages={vm.messages} sessionId={vm.selected} status={vm.runFeedback?.status ?? (vm.active?.isProcessing ? 'running' : vm.active?.lastRun?.status)} online={vm.online} waiting={Boolean(vm.permission)} completion={vm.runFeedback?.completion} scrollRef={vm.scroll} onScroll={handleScroll} onCopyError={vm.report}/></section>}
      </div>
      <div className="composer-shell">{vm.error && <div className="error-banner" role="alert"><span>{vm.error}</span><button aria-label="关闭提示" onClick={() => vm.setError('')}>×</button></div>}{vm.active?.lastRun?.status === 'interrupted' && <div className="notice">上次执行因服务退出而中断。已经保存的内容仍在这里。</div>}{vm.permission && <div className="notice permission"><span>{vm.permission.description}</span><button onClick={() => void vm.respondPermission(false)}>拒绝</button><button onClick={() => void vm.respondPermission(true)}>允许这次</button></div>}<Composer draft={vm.draft} online={vm.online} workspaceReady={Boolean(vm.workspace)} busy={vm.busy} submitting={vm.submitting} model={vm.active?.model || '默认'} connectionLabel={connectionNames[vm.connection]} onDraft={vm.updateDraft} onSend={() => void vm.send()} onCancel={() => void vm.cancel()} onSettings={() => vm.setSettings(true)} /></div>
    </main>
    {vm.details && <DetailsPanel active={vm.active} sources={vm.sources} files={vm.files} filePreview={vm.filePreview} activity={vm.activity} permission={vm.permission} onClose={() => vm.setDetails(false)} onOpenFile={name => void vm.openFile(name)} onPermission={allow => void vm.respondPermission(allow)} />}
    {vm.settings && <SettingsDialog connection={connectionNames[vm.connection]} hasTask={Boolean(vm.active)} model={vm.model} busy={vm.busy} online={vm.online} error={vm.error} canDisconnect={Boolean(onDisconnect)} onModel={vm.setModel} onSave={() => void vm.saveModel()} onClose={() => vm.setSettings(false)} onDisconnect={onDisconnect} />}
  </div>;
}
