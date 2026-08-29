/**
 * Gate 0 minimal session UI skeleton.
 * The streaming transcript UI (AgentEvent 分流渲染) arrives with R10
 * integration in Gate 4; the component structure below is the mount point.
 */

import React, { useState } from 'react';

export function App(): React.ReactElement {
  const [message, setMessage] = useState('');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui' }}>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #ddd' }}>
        <strong>ThreadCove</strong> — 个人深度研究工作台
      </header>
      <main id="transcript" style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        <p style={{ color: '#888' }}>会话内容（流式渲染将在后续 Gate 接入）</p>
      </main>
      <footer style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #ddd' }}>
        <input
          id="composer"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="输入研究问题…"
          style={{ flex: 1, padding: 8 }}
        />
        <button id="send" onClick={() => setMessage('')} style={{ padding: '8px 20px' }}>
          发送
        </button>
      </footer>
    </div>
  );
}
