import { useEffect, useRef, useState } from 'react';
import './conversation-motion.css';

export type RunFeedback = { sessionId: string; runId: string; status: string; completion?: string };
type Props = { status?: string; online: boolean; waiting: boolean; completion?: string };

export const runIndicatorLabels: Record<string, string> = {
  running: '正在研究…',
  completed: '研究已完成',
  failed: '研究失败',
  cancelled: '研究已取消',
  interrupted: '研究已中断',
};

export const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed', 'interrupted']);

/**
 * Pure state calculation for RunIndicator:
 * - Terminal states (completed, cancelled, failed, interrupted) remain preserved when offline.
 * - Only unfinished active research shows 'disconnected' ("连接中断，执行状态待同步") when offline.
 * - Idle/empty tasks without active runs do not show disconnect banners.
 */
export function computeRunIndicatorState(
  status?: string,
  online = true,
  waiting = false,
): { state?: string; label?: string } {
  let state: string | undefined;
  if (status && TERMINAL_STATUSES.has(status)) {
    state = status;
  } else if (!online) {
    if (status === 'running' || waiting) {
      state = 'disconnected';
    } else {
      state = undefined;
    }
  } else if (waiting) {
    state = 'waiting';
  } else {
    state = status;
  }

  if (!state || (state !== 'disconnected' && state !== 'waiting' && !runIndicatorLabels[state])) {
    return {};
  }

  const label = state === 'disconnected'
    ? '连接中断，执行状态待同步'
    : state === 'waiting'
      ? '等待你的确认'
      : runIndicatorLabels[state];

  return { state, label };
}

/** Only a new live completion token can animate; mounting historical state stays quiet; reconnecting does not celebrate. */
export function RunIndicator({ status, online, waiting, completion }: Props) {
  const animatedCompletions = useRef<Set<string>>(new Set());
  const [finishing, setFinishing] = useState(false);

  const { state, label } = computeRunIndicatorState(status, online, waiting);

  useEffect(() => {
    if (state !== 'completed' || !completion || animatedCompletions.current.has(completion)) {
      setFinishing(false);
      return;
    }
    animatedCompletions.current.add(completion);
    setFinishing(true);
    const timer = setTimeout(() => setFinishing(false), 260);
    return () => clearTimeout(timer);
  }, [completion, state]);

  if (!state || !label) return null;

  return (
    <div
      className={`run-indicator${finishing && state === 'completed' ? ' is-finishing' : ''}`}
      data-state={state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="research-line" aria-hidden="true">
        <span className="research-ink" />
        <span className="research-end" />
      </span>
      <span>{label}</span>
    </div>
  );
}
