// Themed column picker — replaces the native `<select>` and native
// `<input type="checkbox">` list that ParameterForm used to render for
// `column` / `columnMulti` parameter kinds. Reasons for the rewrite:
//
//   1. The native `<select>` popup is rendered by the browser and ignores
//      the VS Code theme entirely, which showed up as a jarring white
//      dropdown on a dark editor background.
//   2. The old `columnMulti` checkbox list had no search — unworkable for
//      a dataset with 50+ columns.
//   3. Keyboard UX was inconsistent (native select supported arrow keys;
//      the checkbox list didn't).
//
// This component is a controlled combobox with a built-in search field
// and optional multi-select. It renders the trigger + popup entirely in
// our own DOM so everything is themeable. Single-select mode yields a
// string value; multi-select yields string[].

import { useEffect, useMemo, useRef, useState } from 'react';

export interface ColumnPickerColumn {
  readonly name: string;
  readonly index: number;
  readonly dtype: string;
}

type SingleProps = {
  readonly multi?: false;
  readonly value: string;
  readonly onChange: (value: string) => void;
};
type MultiProps = {
  readonly multi: true;
  readonly value: readonly string[];
  readonly onChange: (value: string[]) => void;
};
type Props = (SingleProps | MultiProps) & {
  readonly columns: ReadonlyArray<ColumnPickerColumn>;
  readonly placeholder?: string;
};

export function ColumnPicker(props: Props) {
  const { columns, placeholder } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus the search input the moment the panel opens — lets the user
  // start typing immediately without a redundant click.
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setQuery('');
    setActiveIndex(0);
    return;
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return columns;
    const q = query.toLowerCase();
    return columns.filter((c) => c.name.toLowerCase().includes(q));
  }, [columns, query]);

  // Clamp the highlight row when the filter list shrinks.
  useEffect(() => {
    if (activeIndex >= filtered.length) {
      setActiveIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, activeIndex]);

  const isSelected = (name: string): boolean => {
    if (props.multi) return props.value.includes(name);
    return props.value === name;
  };

  const toggle = (name: string) => {
    if (props.multi) {
      const next = props.value.includes(name)
        ? props.value.filter((v) => v !== name)
        : [...props.value, name];
      props.onChange(next);
    } else {
      props.onChange(name);
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const col = filtered[activeIndex];
      if (col) toggle(col.name);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const triggerLabel = (() => {
    if (props.multi) {
      if (props.value.length === 0) return placeholder ?? '— select columns —';
      if (props.value.length === 1) return props.value[0];
      return `${props.value.length} columns selected`;
    }
    return props.value || placeholder || '— select column —';
  })();

  const hasValue = props.multi ? props.value.length > 0 : Boolean(props.value);

  return (
    <div className={`kensa-col-picker ${open ? 'kensa-col-picker-open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        className="kensa-col-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {props.multi && props.value.length > 0 && (
          <span className="kensa-col-picker-count">{props.value.length}</span>
        )}
        <span
          className={`kensa-col-picker-label ${hasValue ? '' : 'kensa-col-picker-placeholder'}`}
        >
          {triggerLabel}
        </span>
        <span className="kensa-col-picker-chevron" aria-hidden>▾</span>
      </button>

      {open && (
        <>
          <div
            className="kensa-col-picker-scrim"
            onClick={() => setOpen(false)}
          />
          <div
            className="kensa-col-picker-panel"
            role="listbox"
            aria-multiselectable={props.multi ? true : undefined}
          >
            <input
              ref={searchRef}
              type="text"
              className="kensa-col-picker-search"
              placeholder="Search columns…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {filtered.length === 0 ? (
              <div className="kensa-col-picker-empty">
                No columns match “{query}”
              </div>
            ) : (
              <ul className="kensa-col-picker-list">
                {filtered.map((c, i) => {
                  const selected = isSelected(c.name);
                  return (
                    <li
                      key={c.index}
                      role="option"
                      aria-selected={selected}
                      className={[
                        'kensa-col-picker-option',
                        i === activeIndex ? 'kensa-col-picker-option-active' : '',
                        selected ? 'kensa-col-picker-option-selected' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => toggle(c.name)}
                    >
                      <span className="kensa-col-picker-option-check" aria-hidden>
                        {selected ? '✓' : ''}
                      </span>
                      <span className="kensa-col-picker-option-name">{c.name}</span>
                      <span className="kensa-col-picker-option-dtype">{c.dtype}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
