// src/components/DebugButton.jsx
import { downloadBugReport } from '../utils/bugReporter';

const DebugButton = () => {
  return (
    <button
      onClick={downloadBugReport}
      style={{
        position: 'fixed',
        top: 48,          // ниже кнопки "Выйти" (top: 12px + высота кнопки)
        right: 12,
        zIndex: 9999,
        padding: '8px 12px',
        fontSize: 12,
        background: '#111',
        color: '#fff',
        borderRadius: 6,
        opacity: 0.75,
      }}
    >
      Скачать debug
    </button>
  );
};

export default DebugButton;
