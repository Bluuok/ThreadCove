/**
 * Renderer entry — Gate 0 minimal session UI.
 * Gate 4 wires this to the real ElectronAPI (buildClientApi surface).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
