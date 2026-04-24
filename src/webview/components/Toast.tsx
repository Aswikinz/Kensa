// Small toast notifications used to confirm cell copies and similar
// one-shot actions. Self-contained: owns its own timer + exit animation,
// exposes a single `showToast` function that any component can import.
//
// Kept out of the Zustand store on purpose — toasts are ephemeral UI
// state, not application state, and pushing them through the store would
// force every subscriber to re-render on every notification.

import { useEffect, useState } from 'react';

export interface Toast {
  readonly id: number;
  readonly label: string;
  readonly value?: string;
  readonly kind?: 'info' | 'success';
  readonly icon?: string;
}

type Listener = (toasts: readonly Toast[]) => void;

const AUTO_DISMISS_MS = 1400;
const EXIT_MS = 200;

let nextId = 1;
let activeToasts: Toast[] = [];
let exitingIds: Set<number> = new Set();
const listeners: Listener[] = [];

function publish(): void {
  for (const l of listeners) l(activeToasts);
}

function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  listener(activeToasts);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/** Fire a toast. Returns the toast's id in case a caller wants to dismiss
 *  it early, though in practice auto-dismiss is enough. */
export function showToast(
  label: string,
  options: { value?: string; kind?: 'info' | 'success'; icon?: string } = {}
): number {
  const id = nextId++;
  const toast: Toast = { id, label, ...options };
  activeToasts = [...activeToasts, toast];
  publish();
  // Schedule exit animation, then removal.
  window.setTimeout(() => {
    exitingIds.add(id);
    publish();
    window.setTimeout(() => {
      activeToasts = activeToasts.filter((t) => t.id !== id);
      exitingIds.delete(id);
      publish();
    }, EXIT_MS);
  }, AUTO_DISMISS_MS);
  return id;
}

export function ToastRegion() {
  const [toasts, setToasts] = useState<readonly Toast[]>(activeToasts);
  const [, rerender] = useState(0);

  useEffect(() => {
    // Two subscriptions: one for the toast list, one for exit-flag flips
    // (which don't change the list identity but should re-render to flip
    // the `.kensa-toast-leaving` class).
    const off = subscribe((next) => {
      setToasts(next);
      rerender((n) => n + 1);
    });
    return off;
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="kensa-toast-region" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`kensa-toast ${exitingIds.has(t.id) ? 'kensa-toast-leaving' : ''}`}
        >
          <span className="kensa-toast-icon" aria-hidden>
            {t.icon ?? '✓'}
          </span>
          <span className="kensa-toast-label">{t.label}</span>
          {t.value && <span className="kensa-toast-value">{t.value}</span>}
        </div>
      ))}
    </div>
  );
}
