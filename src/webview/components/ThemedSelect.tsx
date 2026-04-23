// Tiny themed dropdown used wherever a native `<select>` would leak
// OS / browser styling into our dark UI. The browser's option popup
// doesn't honour CSS for the open list on most platforms, which stood
// out badly in the Advanced Filter popover (dark menu → white option
// list). This component renders the trigger + option list entirely in
// our own DOM so both sides match the rest of the app.
//
// API mirrors a minimal subset of `<select>` — value + onChange + an
// options array. No multi-select; use ColumnPicker for that case.

import { useEffect, useRef, useState } from 'react';

export interface ThemedSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

interface Props<T extends string> {
  readonly value: T;
  readonly options: ReadonlyArray<ThemedSelectOption<T>>;
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  readonly placeholder?: string;
}

export function ThemedSelect<T extends string>(props: Props<T>) {
  const { value, options, onChange, ariaLabel, placeholder } = props;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Find the currently-selected option so the trigger can show its
  // label instead of the raw value. Graceful fallback when value
  // doesn't match any option (shouldn't happen but guards against
  // stale state after an options-array change).
  const current = options.find((o) => o.value === value);
  const triggerLabel = current?.label ?? placeholder ?? String(value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className={`kensa-themed-select ${open ? 'kensa-themed-select-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="kensa-themed-select-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="kensa-themed-select-label">{triggerLabel}</span>
        <span className="kensa-themed-select-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <>
          <div
            className="kensa-themed-select-scrim"
            onClick={() => setOpen(false)}
          />
          <ul className="kensa-themed-select-panel" role="listbox">
            {options.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={`kensa-themed-select-option ${
                  opt.value === value ? 'kensa-themed-select-option-selected' : ''
                }`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                <span className="kensa-themed-select-option-check" aria-hidden>
                  {opt.value === value ? '✓' : ''}
                </span>
                <span className="kensa-themed-select-option-label">{opt.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
