import { lazy, Suspense } from 'react';
import { markMiniAppBootstrapCheckpointOnce } from './telegram/mini-app-bootstrap-diagnostics.js';

const TelegramMiniApp = lazy(() => import('./telegram/TelegramMiniApp'));

function App() {
  markMiniAppBootstrapCheckpointOnce('App.jsx render reached');
  return (
    <Suspense fallback={null}>
      <TelegramMiniApp />
    </Suspense>
  );
}

export default App;
