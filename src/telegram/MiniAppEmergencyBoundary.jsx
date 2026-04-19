import React from 'react';
import {
  isTelegramMiniAppPath,
  reportMiniAppBootstrapFailure,
} from './mini-app-bootstrap-diagnostics.js';

class MiniAppEmergencyBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    reportMiniAppBootstrapFailure('React render crash', {
      name: error?.name || 'Error',
      message: error?.message || 'Unknown React render crash',
      stack: error?.stack || errorInfo?.componentStack || null,
    });
  }

  render() {
    if (this.state.error && isTelegramMiniAppPath()) {
      return (
        <div
          data-testid="telegram-mini-app-emergency-shell"
          style={{
            minHeight: '100vh',
            padding: '24px',
            background: '#f8fafc',
            color: '#0f172a',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          <div
            style={{
              maxWidth: '640px',
              margin: '0 auto',
              border: '1px solid #fecaca',
              borderRadius: '16px',
              background: '#ffffff',
              padding: '20px',
              boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
            }}
          >
            <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em' }}>
              Telegram Mini App
            </p>
            <h1 style={{ margin: '12px 0 8px', fontSize: '28px' }}>
              Buyer UI failed during first render
            </h1>
            <p style={{ margin: 0, lineHeight: 1.5 }}>
              A React render error was caught before the buyer shell could mount completely.
            </p>
            <pre
              style={{
                margin: '16px 0 0',
                padding: '12px',
                borderRadius: '12px',
                background: '#fff1f2',
                color: '#9f1239',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {this.state.error?.message || 'Unknown React render crash'}
            </pre>
          </div>
        </div>
      );
    }

    if (this.state.error) {
      return null;
    }

    return this.props.children;
  }
}

export default MiniAppEmergencyBoundary;
