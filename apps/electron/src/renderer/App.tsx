import { Workbench } from '@threadcove/ui';
import type { ElectronAPI } from '@threadcove/shared/client';
declare global { interface Window { threadcove: ElectronAPI } }
export function App() {
  return window.threadcove ? <Workbench api={window.threadcove} /> : <div role="alert">工作台未完成启动，请重新打开应用并检查启动日志。</div>;
}
