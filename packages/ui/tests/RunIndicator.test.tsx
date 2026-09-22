import { describe, it, expect } from 'bun:test';
import {
  computeRunIndicatorState,
  TERMINAL_STATUSES,
} from '../src/components/RunIndicator.tsx';

describe('RunIndicator offline and terminal states', () => {
  it('preserves completed status when offline', () => {
    const { state, label } = computeRunIndicatorState('completed', false, false);
    expect(state).toBe('completed');
    expect(label).toBe('研究已完成');
  });

  it('preserves cancelled status when offline', () => {
    const { state, label } = computeRunIndicatorState('cancelled', false, false);
    expect(state).toBe('cancelled');
    expect(label).toBe('研究已取消');
  });

  it('preserves failed status when offline', () => {
    const { state, label } = computeRunIndicatorState('failed', false, false);
    expect(state).toBe('failed');
    expect(label).toBe('研究失败');
  });

  it('preserves interrupted status when offline', () => {
    const { state, label } = computeRunIndicatorState('interrupted', false, false);
    expect(state).toBe('interrupted');
    expect(label).toBe('研究已中断');
  });

  it('shows disconnected label for running research when offline', () => {
    const { state, label } = computeRunIndicatorState('running', false, false);
    expect(state).toBe('disconnected');
    expect(label).toBe('连接中断，执行状态待同步');
  });

  it('shows disconnected label for waiting research when offline', () => {
    const { state, label } = computeRunIndicatorState(undefined, false, true);
    expect(state).toBe('disconnected');
    expect(label).toBe('连接中断，执行状态待同步');
  });

  it('returns empty state when offline and no active research exists', () => {
    const { state, label } = computeRunIndicatorState(undefined, false, false);
    expect(state).toBeUndefined();
    expect(label).toBeUndefined();
  });

  it('renders running state when online', () => {
    const { state, label } = computeRunIndicatorState('running', true, false);
    expect(state).toBe('running');
    expect(label).toBe('正在研究…');
  });

  it('renders waiting state when online and permission is requested', () => {
    const { state, label } = computeRunIndicatorState('running', true, true);
    expect(state).toBe('waiting');
    expect(label).toBe('等待你的确认');
  });

  it('verifies all terminal statuses are accounted for', () => {
    expect(TERMINAL_STATUSES.has('completed')).toBe(true);
    expect(TERMINAL_STATUSES.has('cancelled')).toBe(true);
    expect(TERMINAL_STATUSES.has('failed')).toBe(true);
    expect(TERMINAL_STATUSES.has('interrupted')).toBe(true);
    expect(TERMINAL_STATUSES.has('running')).toBe(false);
  });
});
