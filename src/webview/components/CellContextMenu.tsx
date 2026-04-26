// Right-click context menu rendered over the DataGrid. Shows the
// operations you'd expect from a spreadsheet-style viewer: copy the
// cell value, copy the whole row, filter rows by this value, sort by
// this column.
//
// Rendered as a fixed-position popover anchored at the cursor position
// that triggered it. A full-viewport scrim captures outside clicks and
// closes the menu. Keyboard Escape also closes.
//
// Kept dumb — all state lives in the parent DataGrid which decides
// when to mount / unmount this. That way the menu has no lifecycle
// work of its own beyond the close handlers.

import { useEffect } from 'react';
import { truncateForToast } from '../formatters';
import type { FilterOp } from '../../shared/types';

export interface CellContextTarget {
  readonly rowIdx: number;
  readonly colIdx: number;
  readonly columnName: string;
  readonly columnDtype: string;
  readonly value: string | null | undefined;
  readonly cursorX: number;
  readonly cursorY: number;
}

interface Props {
  readonly target: CellContextTarget;
  readonly onClose: () => void;
  readonly onCopyValue: () => void;
  readonly onCopyRow: () => void;
  readonly onCopyColumn: () => void;
  readonly onCopyColumnName: () => void;
  readonly onFilter: (op: FilterOp) => void;
  readonly onSort: (ascending: boolean) => void;
  readonly onClearColumnFilters: () => void;
  readonly hasColumnFilters: boolean;
}

export function CellContextMenu(props: Props) {
  const { target, onClose } = props;
  const isMissing = target.value === null || target.value === undefined;
  const valueStr = isMissing ? '—' : String(target.value);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Clamp the menu position so it doesn't overflow the viewport. Rather
  // than querying the menu's rendered size (which would require a
  // second render pass), we assume a ~220×260px footprint — good enough
  // for the fixed item set below.
  const estW = 220;
  const estH = 260;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const left = Math.min(target.cursorX, vw - estW - 8);
  const top = Math.min(target.cursorY, vh - estH - 8);

  const canFilter = !isMissing;

  return (
    <>
      <div className="kensa-context-menu-scrim" onClick={onClose} />
      <div
        className="kensa-context-menu"
        role="menu"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="kensa-context-menu-header" title={target.columnName}>
          {target.columnName}
          <span className="kensa-context-menu-header-value" title={valueStr}>
            {isMissing ? 'missing' : truncateForToast(valueStr, 40)}
          </span>
        </div>

        <MenuItem
          icon="⎘"
          label="Copy cell"
          disabled={isMissing}
          onClick={() => {
            props.onCopyValue();
            onClose();
          }}
        />
        <MenuItem
          icon="≡"
          label="Copy row (TSV)"
          onClick={() => {
            props.onCopyRow();
            onClose();
          }}
        />
        <MenuItem
          icon="⫶"
          label="Copy column (TSV)"
          onClick={() => {
            props.onCopyColumn();
            onClose();
          }}
        />
        <MenuItem
          icon="ʟ"
          label="Copy column name"
          onClick={() => {
            props.onCopyColumnName();
            onClose();
          }}
        />

        <div className="kensa-context-menu-divider" />

        <MenuItem
          icon="="
          label={`Filter: equals "${truncateForToast(valueStr, 14)}"`}
          disabled={!canFilter}
          onClick={() => {
            props.onFilter('eq');
            onClose();
          }}
        />
        <MenuItem
          icon="≠"
          label={`Filter: not equal to "${truncateForToast(valueStr, 10)}"`}
          disabled={!canFilter}
          onClick={() => {
            props.onFilter('ne');
            onClose();
          }}
        />
        <MenuItem
          icon="⊃"
          label={`Filter: contains "${truncateForToast(valueStr, 12)}"`}
          disabled={!canFilter}
          onClick={() => {
            props.onFilter('contains');
            onClose();
          }}
        />

        <div className="kensa-context-menu-divider" />

        <MenuItem
          icon="↑"
          label="Sort ascending"
          onClick={() => {
            props.onSort(true);
            onClose();
          }}
        />
        <MenuItem
          icon="↓"
          label="Sort descending"
          onClick={() => {
            props.onSort(false);
            onClose();
          }}
        />

        {props.hasColumnFilters && (
          <>
            <div className="kensa-context-menu-divider" />
            <MenuItem
              icon="×"
              label="Clear filters on this column"
              danger
              onClick={() => {
                props.onClearColumnFilters();
                onClose();
              }}
            />
          </>
        )}
      </div>
    </>
  );
}

function MenuItem({
  icon,
  label,
  disabled,
  danger,
  onClick
}: {
  readonly icon: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`kensa-context-menu-item ${danger ? 'kensa-context-menu-item-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="kensa-context-menu-item-icon" aria-hidden>
        {icon}
      </span>
      <span className="kensa-context-menu-item-label">{label}</span>
    </button>
  );
}
