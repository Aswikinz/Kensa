// Small set of inline SVG icons used by the toolbar. Every icon inherits
// `color` via `currentColor` so they automatically pick up VS Code's theme
// foreground. Size defaults to 18px — bigger than the old Unicode glyphs
// so the toolbar buttons feel properly weighted.
//
// Kept as a single file (rather than a subdirectory of one-icon modules)
// because there are only a handful and they're all tiny.

import type { SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  readonly size?: number;
}

function baseProps(size: number | undefined, rest: Omit<IconProps, 'size'>) {
  const s = size ?? 18;
  return {
    width: s,
    height: s,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest
  };
}

/** Three horizontal sliders with draggable knobs. Represents the
 *  operations panel. */
export function OperationsIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
      <circle cx="11" cy="4" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="8" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="9.5" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Angle brackets. Represents the generated code preview panel. */
export function CodeIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <polyline points="5 4 2 8 5 12" />
      <polyline points="11 4 14 8 11 12" />
      <line x1="9.5" y1="3" x2="6.5" y2="13" />
    </svg>
  );
}

/** Info circle. Represents the dataset summary / stats panel. */
export function SummaryIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <circle cx="8" cy="8" r="6.2" />
      <line x1="8" y1="7.3" x2="8" y2="11.5" />
      <circle cx="8" cy="5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Download arrow into a tray. Represents "Export data". */
export function ExportIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <path d="M2 10.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" />
      <polyline points="4.8 7 8 10.3 11.2 7" />
      <line x1="8" y1="2.2" x2="8" y2="10.3" />
    </svg>
  );
}

/** Small funnel used in the filter badge. */
export function FilterIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <path d="M2.5 3h11l-4.2 5.4v4.3l-2.6 1.3V8.4z" />
    </svg>
  );
}

/** Mode toggle chevrons — rendered in the mode toggle in case we ever need
 *  a purely-icon version. Not currently wired to the toolbar (the text
 *  labels "View" / "Edit" are clearer) but kept here for future use. */
export function EyeIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2.2" />
    </svg>
  );
}

export function PencilIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <path d="M11.3 2.8l1.9 1.9-8.3 8.3H3v-1.9z" />
      <line x1="10" y1="4.1" x2="11.9" y2="6" />
    </svg>
  );
}

/** Lightning bolt — represents the native Rust engine ("fast view"). The
 *  glyph is drawn as a filled polygon so it reads cleanly at toolbar size
 *  even when the rest of the icons use line-art. */
export function BoltIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)} fill="currentColor" stroke="none">
      <path d="M9.4 1.2 2.8 9.1c-.3.4 0 1 .5 1H7l-1.1 4.7c-.1.6.6 1 1 .5l6.5-7.9c.3-.4 0-1-.5-1H9l1-4.7c.1-.6-.6-1-1-.5z" />
    </svg>
  );
}

/** Terminal window with a `>` prompt — represents the Python subprocess
 *  backend. We deliberately don't use the Python snake logo (trademark);
 *  this is a generic "code execution environment" glyph. */
export function TerminalIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <polyline points="4.2 6 6.8 8 4.2 10" />
      <line x1="8.2" y1="10.4" x2="11.6" y2="10.4" />
    </svg>
  );
}

/** Circular refresh arrow with a small arrowhead — represents "re-pull the
 *  data from its source" (re-extract a Jupyter variable, re-read a file). */
export function RefreshIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <path d="M13.4 8a5.5 5.5 0 1 1-1.6-3.9" />
      <polyline points="13.7 1.8 13.7 4.5 11 4.5" />
    </svg>
  );
}
