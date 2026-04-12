// Left-side operations catalog. Shows all 29 built-in operations grouped by
// category with a quick search filter. Selecting an operation reveals its
// parameter form in-place.

import { useMemo, useState } from 'react';
import { OPERATIONS, operationsByCategory, type OperationSpec } from '../../shared/operations';
import { useKensaStore } from '../state/store';
import { ParameterForm } from './ParameterForm';

export function OperationsPanel() {
  const [query, setQuery] = useState('');
  const { selectedOperationId, setSelectedOperation } = useKensaStore();

  const filtered: OperationSpec[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...OPERATIONS];
    return OPERATIONS.filter(
      (op) =>
        op.label.toLowerCase().includes(q) ||
        op.description.toLowerCase().includes(q) ||
        op.category.toLowerCase().includes(q)
    );
  }, [query]);

  const selected = OPERATIONS.find((o) => o.id === selectedOperationId);

  if (selected) {
    return (
      <div className="kensa-operations">
        <div className="kensa-operations-header">
          <button
            type="button"
            className="kensa-linky"
            onClick={() => setSelectedOperation(null)}
          >
            ← Operations
          </button>
        </div>
        <div className="kensa-op-title">{selected.label}</div>
        <div className="kensa-op-desc">{selected.description}</div>
        <ParameterForm operation={selected} />
      </div>
    );
  }

  const byCat = operationsByCategory();
  const visibleCategories = Array.from(byCat.entries()).map(([cat, ops]) => ({
    cat,
    ops: ops.filter((op) => filtered.includes(op))
  })).filter(({ ops }) => ops.length > 0);

  return (
    <div className="kensa-operations">
      <div className="kensa-operations-header">
        <input
          type="text"
          className="kensa-search"
          placeholder="Search operations…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="kensa-operations-list">
        {visibleCategories.map(({ cat, ops }) => (
          <div key={cat} className="kensa-op-category">
            <div className="kensa-op-category-title">{cat}</div>
            <ul>
              {ops.map((op) => (
                <li key={op.id}>
                  <button
                    type="button"
                    className="kensa-op-item"
                    onClick={() => setSelectedOperation(op.id)}
                  >
                    {op.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
