import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initVsCodeApi } from './vscodeApi';
import './styles/app.css';

initVsCodeApi();

const root = document.getElementById('kensa-root');
if (!root) {
  throw new Error('#kensa-root not found in webview HTML');
}
createRoot(root).render(<App />);
