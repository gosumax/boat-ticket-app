// src/components/DebugButton.jsx
import { downloadBugReport } from '../utils/bugReporter';

const DebugButton = () => {
  return (
    <button
      onClick={downloadBugReport}
      style={{
        position: 'fixed',
        bottom: 12,
        right: 12,
        zIndex: 9999,
        padding: '8px 12px',
        fontSize: 12,
        background: '#111',
        color: '#fff',
        borderRadius: 6,
        opacity: 0.7
      }}
    >
      Скачать debug
    </button>
  );
};

export default DebugButton;
