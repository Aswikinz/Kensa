// Bottom code-preview panel. Shows the current step's generated Python, or
// the full composed pipeline when no individual step is selected. The editor
// is live — edits debounce and execute via `executeCustomCode`, which runs
// against the Python backend and updates the grid.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import { CodeEditor } from './CodeEditor';

export function CodePreview() {
  const { previewCode, steps, mode, setPreviewCode } = useKensaStore();
  const composed = joinSteps(steps.map((s) => s.code));
  const initial = previewCode || composed;
  const [draft, setDraft] = useState(initial);
  const lastExternalRef = useRef(initial);

  // Pull remote updates (e.g. a newly applied step) into the draft, but only
  // when the user isn't actively editing — compared via a latched ref so our
  // own setDraft calls don't trigger a feedback loop.
  useEffect(() => {
    if (initial !== lastExternalRef.current) {
      lastExternalRef.current = initial;
      setDraft(initial);
    }
  }, [initial]);

  const submit = useCallback(
    (value: string) => {
      if (!value.trim()) return;
      postMessage({ type: 'executeCustomCode', code: value });
      setPreviewCode(value);
    },
    [setPreviewCode]
  );

  return (
    <div className="kensa-code-preview">
      <div className="kensa-code-header">
        <div className="kensa-code-title">
          Generated Python ({mode}) — ⌘/Ctrl+Enter to run
        </div>
        <div className="kensa-code-actions">
          <button
            type="button"
            className="kensa-btn"
            onClick={() => submit(draft)}
            disabled={mode !== 'editing'}
          >
            Run
          </button>
          <button
            type="button"
            className="kensa-btn"
            onClick={() => postMessage({ type: 'exportCode', format: 'notebook' })}
          >
            Export to notebook
          </button>
          <button
            type="button"
            className="kensa-btn"
            onClick={() => {
              if (navigator.clipboard) navigator.clipboard.writeText(draft);
            }}
          >
            Copy
          </button>
        </div>
      </div>
      <div className="kensa-code-body-wrap">
        <CodeEditor
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          placeholder="# No steps yet. Select an operation from the left or type Python here."
          readOnly={false}
        />
      </div>
    </div>
  );
}

function joinSteps(codes: string[]): string {
  return codes.filter(Boolean).join('\n');
}
