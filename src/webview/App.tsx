import { useEffect } from 'react';
import { DataGrid } from './components/DataGrid';
import { SummaryPanel } from './components/SummaryPanel';
import { OperationsPanel } from './components/OperationsPanel';
import { StepsPanel } from './components/StepsPanel';
import { CodePreview } from './components/CodePreview';
import { Toolbar } from './components/Toolbar';
import { ToastRegion } from './components/Toast';
import { useKensaStore } from './state/store';
import { onMessage, postMessage } from './vscodeApi';

export function App() {
  const {
    slice,
    mode,
    showSummaryPanel,
    showOperationsPanel,
    showCodePreview,
    loading,
    error,
    setSlice,
    setInsights,
    setColumnStats,
    setMode,
    setEngine,
    setSource,
    setFileName,
    addStep,
    removeStep,
    setError,
    setFlashFillExpression,
    setDiff,
    setPreview,
    mergePreviewSlice,
    clearPreview
  } = useKensaStore();

  // Single subscription to extension messages; the store absorbs everything.
  useEffect(() => {
    const off = onMessage((msg) => {
      switch (msg.type) {
        case 'bootstrap':
          setMode(msg.mode);
          setEngine(msg.engine);
          setSource(msg.source);
          setFileName(msg.fileName);
          break;
        case 'dataSlice':
          setSlice(msg.slice);
          break;
        case 'columnStats':
          setColumnStats(msg.columnIndex, msg.stats);
          break;
        case 'allColumnInsights':
          setInsights(msg.insights);
          break;
        case 'operationApplied':
          addStep(msg.step);
          setSlice(msg.slice);
          setDiff(msg.diff ?? null);
          clearPreview();
          break;
        case 'stepRemoved':
          removeStep(msg.stepId);
          setSlice(msg.slice);
          setDiff(null);
          clearPreview();
          break;
        case 'operationPreview':
          setPreview(msg.slice, msg.diff, msg.changedMask ?? [], msg.code);
          break;
        case 'previewSlice':
          mergePreviewSlice(msg.slice, msg.changedMask ?? []);
          break;
        case 'previewCleared':
          clearPreview();
          break;
        case 'modeChanged':
          setMode(msg.mode);
          break;
        case 'engineStatus':
          setEngine(msg.engine);
          break;
        case 'error':
          setError(msg.message);
          break;
        case 'flashFillResult':
          setFlashFillExpression(msg.columnIndex, msg.expression);
          break;
      }
    });
    postMessage({ type: 'ready' });
    return off;
  }, [
    setSlice,
    setInsights,
    setColumnStats,
    setMode,
    setEngine,
    setSource,
    setFileName,
    addStep,
    removeStep,
    setError,
    setFlashFillExpression,
    setDiff,
    setPreview,
    mergePreviewSlice,
    clearPreview
  ]);

  return (
    <div className="kensa-app">
      <Toolbar />
      <div className={`kensa-body mode-${mode}`}>
        {showOperationsPanel && (
          <aside className="kensa-sidebar kensa-sidebar-left">
            <OperationsPanel />
            <StepsPanel />
          </aside>
        )}

        <main className="kensa-main">
          {error && <div className="kensa-error-banner">{error}</div>}
          {loading && !slice && <div className="kensa-placeholder">Loading dataset…</div>}
          {slice && <DataGrid slice={slice} />}
          {showCodePreview && <CodePreview />}
        </main>

        {showSummaryPanel && (
          <aside className="kensa-sidebar kensa-sidebar-right">
            <SummaryPanel />
          </aside>
        )}
      </div>
      <ToastRegion />
    </div>
  );
}
