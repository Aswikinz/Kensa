// Ordered list of applied cleaning steps. Each row has an undo button; the
// most recent step is highlighted. Clicking a row shows its generated code in
// the bottom code preview panel.

import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';

export function StepsPanel() {
  const steps = useKensaStore((s) => s.steps);
  const setPreviewCode = useKensaStore((s) => s.setPreviewCode);

  if (steps.length === 0) {
    return (
      <div className="kensa-steps">
        <div className="kensa-steps-title">Cleaning steps</div>
        <div className="kensa-placeholder">No steps applied yet.</div>
      </div>
    );
  }

  return (
    <div className="kensa-steps">
      <div className="kensa-steps-title">Cleaning steps</div>
      <ol className="kensa-steps-list">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={`kensa-step ${i === steps.length - 1 ? 'kensa-step-last' : ''}`}
          >
            <button
              type="button"
              className="kensa-step-label"
              onClick={() => setPreviewCode(step.code)}
            >
              <span className="kensa-step-num">{i + 1}.</span> {step.label}
            </button>
            <button
              type="button"
              className="kensa-step-undo"
              title="Undo step"
              onClick={() => postMessage({ type: 'undoStep', stepId: step.id })}
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
