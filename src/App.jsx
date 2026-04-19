import TelegramMiniApp from './telegram/TelegramMiniApp';
import { markMiniAppBootstrapCheckpointOnce } from './telegram/mini-app-bootstrap-diagnostics.js';

function App() {
  markMiniAppBootstrapCheckpointOnce('App.jsx render reached');
  return <TelegramMiniApp />;
}

export default App;
