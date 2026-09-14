type Props = {
  draft: string;
  online: boolean;
  workspaceReady: boolean;
  busy: boolean;
  submitting: boolean;
  model: string;
  connectionLabel: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  onSettings: () => void;
};

export function Composer({ draft, online, workspaceReady, busy, submitting, model, connectionLabel, onDraft, onSend, onCancel, onSettings }: Props) {
  return <div className="composer-area"><form className={`composer ${busy ? 'is-busy' : ''}`} onSubmit={event => { event.preventDefault(); onSend(); }}>
    <div className="composer-label"><label htmlFor="research-question">{busy ? '研究进行中 / 可随时停止' : '新线索 / 想研究什么？'}</label><span>草稿自动保存</span></div>
    <textarea id="research-question" aria-label="研究问题" placeholder={online ? '提出问题，或先写下一个想法…' : '连接就绪后，即可开始研究'} value={draft} onChange={event => onDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSend(); } }} rows={2}/>
    <div className="composer-tools"><button type="button" className="model-button" onClick={onSettings}>研究模型 · {model || '默认'} <span>⌄</span></button>{busy ? <button className="send-button stop" type="button" aria-label="停止" disabled={!online || submitting} onClick={onCancel}>■ 停止</button> : <button className="send-button" type="submit" aria-label="开始研究" disabled={!online || !workspaceReady || !draft.trim()}>开始研究 ↗</button>}</div>
  </form><div className="composer-footnote"><span>{online ? '内容保存在当前工作区' : connectionLabel}</span><span>Enter 发送 / Shift + Enter 换行</span></div></div>;
}
