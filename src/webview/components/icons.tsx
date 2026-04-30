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

/** Magnifier — shared icon for any search/find affordance. Same stroke
 *  weight and viewBox as the rest so sizes match side-by-side with
 *  RefreshIcon / FilterIcon in the toolbar. */
export function SearchIcon({ size, ...rest }: IconProps) {
  return (
    <svg {...baseProps(size, rest)}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="13.5" y2="13.5" />
    </svg>
  );
}

/** Brand mark — uses fixed pink + blue (not `currentColor`) since the
 *  identity colours need to read consistently regardless of the
 *  surrounding theme. Source: `media/icon-tab.svg` (the same file the
 *  panel tab icon and marketplace listing use). Inlined here so it
 *  participates in the React tree and can be sized like every other
 *  icon. */
export function KensaLogo({ size, ...rest }: IconProps) {
  const s = size ?? 18;
  const { width: _w, height: _h, viewBox: _v, fill: _f, stroke: _s, strokeWidth: _sw, ...passthrough } = rest as Record<string, unknown>;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 96 95.999999"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable={false}
      {...(passthrough as SVGProps<SVGSVGElement>)}
    >
      <defs>
        <clipPath id="kensa-logo-clip-a">
          <path d="M 7 1.777344 L 54 1.777344 L 54 50 L 7 50 Z M 7 1.777344" />
        </clipPath>
        <clipPath id="kensa-logo-clip-b">
          <path d="M 17 1.777344 L 86.933594 1.777344 L 86.933594 87 L 17 87 Z M 17 1.777344" />
        </clipPath>
        <clipPath id="kensa-logo-clip-c">
          <path d="M 11 1.777344 L 71 1.777344 L 71 64 L 11 64 Z M 11 1.777344" />
        </clipPath>
      </defs>
      <g clipPath="url(#kensa-logo-clip-a)">
        <path
          fill="#1881c4"
          d="M 9.273438 49.105469 C 8.039062 42.734375 13.707031 36.761719 13.765625 36.703125 L 13.769531 36.699219 L 53.429688 1.78125 L 44.492188 1.78125 L 11.980469 30.890625 C 8.382812 34.113281 6.695312 38.851562 7.476562 43.5625 C 7.914062 46.199219 8.855469 48.28125 9.273438 49.105469"
        />
      </g>
      <path
        fill="#eb078c"
        d="M 40.09375 55.558594 L 71.320312 93.933594 L 79.761719 93.933594 L 45.105469 50.546875 L 40.09375 55.558594"
      />
      <path
        fill="#eb078c"
        d="M 30.359375 64.867188 L 53.664062 93.933594 L 64.734375 93.933594 L 36.453125 58.929688 L 30.359375 64.867188"
      />
      <g clipPath="url(#kensa-logo-clip-b)">
        <path
          fill="#1881c4"
          d="M 34.042969 85.527344 C 33.972656 85.460938 33.898438 85.382812 33.820312 85.304688 C 33.777344 85.265625 33.734375 85.21875 33.691406 85.175781 C 33.644531 85.125 33.59375 85.074219 33.542969 85.023438 C 33.5 84.980469 33.460938 84.9375 33.414062 84.890625 C 32.183594 83.613281 30.289062 81.472656 28.585938 78.84375 C 27.355469 76.9375 26.015625 74.546875 25.214844 71.957031 C 24.503906 68.519531 25.585938 64.878906 28.097656 62.308594 L 87.234375 1.78125 L 76.042969 1.78125 L 22.683594 54.789062 C 21.886719 55.582031 10.484375 66.9375 24.75 86.085938 L 34.621094 86.085938 C 34.507812 85.984375 34.320312 85.804688 34.078125 85.5625 L 34.042969 85.527344"
        />
      </g>
      <g clipPath="url(#kensa-logo-clip-c)">
        <path
          fill="#1881c4"
          d="M 61.179688 1.777344 L 61.167969 1.785156 L 18.570312 41.503906 L 17.441406 42.554688 C 14.507812 45.292969 12.585938 48.953125 12.089844 52.867188 L 12.085938 52.886719 C 12.050781 53.121094 12.023438 53.355469 12.015625 53.578125 L 12.015625 53.601562 C 11.960938 54.289062 11.949219 54.984375 11.984375 55.6875 C 12.109375 58.117188 12.773438 60.742188 14.425781 63.289062 C 14.425781 63.289062 13.699219 57.210938 17.101562 53.761719 L 70.015625 1.804688 L 70.046875 1.777344 L 61.179688 1.777344"
        />
      </g>
    </svg>
  );
}
