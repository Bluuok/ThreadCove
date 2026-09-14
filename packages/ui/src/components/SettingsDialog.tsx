type Props = {
  connection: string;
  hasTask: boolean;
  model: string;
  busy: boolean;
  online: boolean;
  error: string;
  canDisconnect: boolean;
  onModel: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  onDisconnect?: () => void;
};

export function SettingsDialog({ connection, hasTask, model, busy, online, error, canDisconnect, onModel, onSave, onClose, onDisconnect }: Props) {
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header><div><span className="mono-label">FIELD CONFIGURATION</span><h2 id="settings-title">研究偏好</h2></div><button autoFocus aria-label="关闭设置" onClick={onClose}>×</button></header>
    <p className="settings-status">当前连接 <strong>{connection}</strong></p>
    {hasTask ? <form onSubmit={event => { event.preventDefault(); onSave(); }}><label>此任务使用的模型<input value={model} onChange={event => onModel(event.target.value)} placeholder="模型 ID" /></label><p>使用当前 Provider 支持的模型 ID。执行结束后可以切换。</p><div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button className="accent-button" aria-label="保存模型" disabled={busy || !online || !model.trim()}>保存模型</button></div></form> : <p>新建任务后，可以为该任务选择模型。</p>}
    {canDisconnect && <button className="disconnect-button" onClick={onDisconnect}>更换连接 ↗</button>}{error && <div role="alert" className="error-banner">{error}</div>}
  </section></div>;
}
