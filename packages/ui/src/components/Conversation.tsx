import type { StoredMessage } from '@threadcove/core/types';
import { RunIndicator } from './RunIndicator.tsx';

type Props = {
  messages: StoredMessage[];
  status?: string;
  online: boolean;
  waiting: boolean;
  completion?: string;
  sessionId: string;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  onCopyError: (error: unknown) => void;
};

export function Conversation({ messages, status, online, waiting, completion, sessionId, scrollRef, onScroll, onCopyError }: Props) {
  return <div className="conversation" ref={scrollRef} onScroll={onScroll}>
    <div className="conversation-inner">
      {messages.map(message => <article key={message.id} className={`message message-${message.type}`}>
        <div className="message-meta"><span>{message.type === 'user' ? '你 / 提问' : message.type === 'assistant' ? 'THREADCOVE / 研究回复' : message.type === 'tool' ? `${message.toolName || '工具'} / 结果` : '执行记录'}</span><time>{new Date(message.timestamp ?? 0).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></div>
        <div className="message-content">{message.content}</div>
        {message.type === 'assistant' && <button className="copy-button" onClick={() => void navigator.clipboard.writeText(message.content).catch(onCopyError)}>复制文本</button>}
      </article>)}
      <RunIndicator key={sessionId} status={status} online={online} waiting={waiting} completion={completion}/>
    </div>
  </div>;
}
