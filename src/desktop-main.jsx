import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { AuthProvider } from './contexts/AuthContext';
import DesktopApp from './DesktopApp';
import MiniAppEmergencyBoundary from './telegram/MiniAppEmergencyBoundary';
import './index.css';

// 🔧 Global bug reporter (init once)
import './utils/bugReporter.js';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Unable to find #root for React mount');
}

ReactDOM.createRoot(rootElement).render(
  <BrowserRouter>
    <AuthProvider>
      <MiniAppEmergencyBoundary>
        <DesktopApp />
      </MiniAppEmergencyBoundary>
    </AuthProvider>
  </BrowserRouter>
);
