// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import './index.css';

// 🔧 Global bug reporter (init once)
import './utils/bugReporter.js';

console.log('[MAIN] mount start');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

console.log('[MAIN] mount done');
