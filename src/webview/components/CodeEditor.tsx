// Lightweight syntax-highlighted Python editor. A transparent <textarea> is
// overlaid on a tokenized <pre> so the native caret/selection works while the
// colors come from our own highlighter. Same pattern as react-simple-code-editor,
// without the dependency. Roughly ~2kb gzipped — compared to Monaco at ~1MB.
//
// The editor is fully controlled: it takes `value` and calls `onChange` on
// every keystroke. The parent component handles debouncing before sending the
// code back to Python.

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';

interface CodeEditorProps {
  readonly value: string;
  readonly readOnly?: boolean;
  readonly onChange?: (next: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly minHeight?: number;
}

const sharedStyle: CSSProperties = {
  fontFamily: 'var(--vscode-editor-font-family, monospace)',
  fontSize: 'var(--vscode-editor-font-size, 13px)',
  lineHeight: '1.5',
  whiteSpace: 'pre',
  tabSize: 4,
  padding: '10px 12px',
  margin: 0,
  border: 'none',
  outline: 'none'
};

export function CodeEditor({
  value,
  readOnly = false,
  onChange,
  onSubmit,
  placeholder,
  minHeight = 80
}: CodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // Keep the highlighted layer's scroll position in sync with the textarea's —
  // crucial because the textarea is transparent on top of the <pre>.
  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  useEffect(() => {
    syncScroll();
  }, [value, syncScroll]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      onSubmit(value);
      return;
    }
    // Tab inserts four spaces instead of moving focus.
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + '    ' + value.slice(end);
      onChange?.(next);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 4;
          textareaRef.current.selectionEnd = start + 4;
        }
      });
    }
  };

  return (
    <div className="kensa-code-editor" style={{ position: 'relative', minHeight, flex: 1 }}>
      <pre
        ref={highlightRef}
        className="kensa-code-editor-highlight"
        aria-hidden="true"
        style={{
          ...sharedStyle,
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
          color: 'var(--vscode-editor-foreground)',
          background: 'transparent',
          pointerEvents: 'none'
        }}
      >
        <code dangerouslySetInnerHTML={{ __html: highlightPython(value || '') + '\n' }} />
      </pre>
      <textarea
        ref={textareaRef}
        className="kensa-code-editor-input"
        value={value}
        spellCheck={false}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        style={{
          ...sharedStyle,
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          background: 'transparent',
          color: 'transparent',
          caretColor: 'var(--vscode-editor-foreground)',
          resize: 'none',
          overflow: 'auto'
        }}
      />
    </div>
  );
}

// -- Python highlighter -------------------------------------------------------

const PY_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'try', 'while', 'with', 'yield', 'True', 'False', 'None'
]);

const PY_BUILTINS = new Set([
  'pd', 'np', 'df', 'print', 'len', 'range', 'list', 'dict', 'set', 'tuple',
  'int', 'float', 'str', 'bool', 'abs', 'min', 'max', 'sum', 'map', 'filter'
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function wrap(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

/** Single-pass tokenizer. Not a full parser — good enough for human eyes. */
function highlightPython(code: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];

    // Line comment
    if (ch === '#') {
      let end = code.indexOf('\n', i);
      if (end === -1) end = code.length;
      out.push(wrap('py-comment', code.slice(i, end)));
      i = end;
      continue;
    }

    // String (single or double quoted, no multiline support — fine for our use)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let end = i + 1;
      while (end < code.length && code[end] !== quote) {
        if (code[end] === '\\') end += 2;
        else end += 1;
      }
      end = Math.min(end + 1, code.length);
      out.push(wrap('py-string', code.slice(i, end)));
      i = end;
      continue;
    }

    // Number literal
    if (/[0-9]/.test(ch)) {
      let end = i + 1;
      while (end < code.length && /[0-9._]/.test(code[end] ?? '')) end += 1;
      out.push(wrap('py-number', code.slice(i, end)));
      i = end;
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let end = i + 1;
      while (end < code.length && /[A-Za-z0-9_]/.test(code[end] ?? '')) end += 1;
      const word = code.slice(i, end);
      if (PY_KEYWORDS.has(word)) {
        out.push(wrap('py-keyword', word));
      } else if (PY_BUILTINS.has(word)) {
        out.push(wrap('py-builtin', word));
      } else {
        out.push(escapeHtml(word));
      }
      i = end;
      continue;
    }

    // Operator / punctuation (minimal — mostly for visual contrast)
    if (/[+\-*/%=<>!&|^~]/.test(ch)) {
      out.push(wrap('py-op', ch));
      i += 1;
      continue;
    }

    // Whitespace / anything else
    out.push(escapeHtml(ch));
    i += 1;
  }
  return out.join('');
}

export { highlightPython };
