// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import MiniAppEmergencyBoundary from './telegram/MiniAppEmergencyBoundary';
import {
  markMiniAppBootstrapCheckpointOnce,
  reportMiniAppBootstrapFailure,
  setupModuleLoadDiagnostics,
} from './telegram/mini-app-bootstrap-diagnostics.js';
import './index.css';

// 🔧 Global bug reporter (init once)
import './utils/bugReporter.js';

// Install module load diagnostics before any other code executes
setupModuleLoadDiagnostics();

console.log('[MAIN] mount start');
markMiniAppBootstrapCheckpointOnce('main.jsx before React mount');

const rootElement = document.getElementById('root');

if (!rootElement) {
  reportMiniAppBootstrapFailure('main.jsx missing #root', 'Unable to find #root');
  throw new Error('Unable to find #root for React mount');
}

ReactDOM.createRoot(rootElement).render(
  <MiniAppEmergencyBoundary>
    <App />
  </MiniAppEmergencyBoundary>
);

console.log('[MAIN] mount done');
