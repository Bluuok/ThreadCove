import { useEffect, useRef, useState } from 'react';
import './conversation-motion.css';

export type RunFeedback = { sessionId: string; runId: string; status: string; completion?: string };
type Props = { status?: string; online: boolean; waiting: boolean; completion?: string };
const labels: Record<string, string> = { running: '正在研究…', completed: '研究已完成', failed: '研究失败', cancelled: '研究已取消', interrupted: '研究已中断' };

/** Only a new live completion token can animate; mounting historical state stays quiet. */
export function RunIndicator({ status, online, waiting, completion }: Props) {
  const previous = useRef(completion);
  const [finishing, setFinishing] = useState(false);
  const state = !online ? 'disconnected' : waiting ? 'waiting' : status;
  useEffect(() => {
    const fresh = Boolean(completion && completion !== previous.current);
    previous.current = completion;
    if (state !== 'completed' || !fresh) { setFinishing(false); return; }
    setFinishing(true);
    const timer = setTimeout(() => setFinishing(false), 260);
    return () => clearTimeout(timer);
  }, [completion, state]);
  if (!state || (online && !waiting && !labels[state])) return null;
  const label = state === 'disconnected' ? '连接中断，执行状态待同步' : state === 'waiting' ? '等待你的确认' : labels[state];
  return <div className={`run-indicator${finishing && state === 'completed' ? ' is-finishing' : ''}`} data-state={state} role="status" aria-live="polite" aria-atomic="true">
    <span className="research-line" aria-hidden="true"><span className="research-ink"/><span className="research-end"/></span>
    <span>{label}</span>
  </div>;
}
