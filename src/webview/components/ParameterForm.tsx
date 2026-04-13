// Dynamic form rendered from an OperationSpec.parameters schema. Each
// parameter kind maps to a small inline component; on Apply we ship the full
// params bag to the extension host as an applyOperation message.

import { useState } from 'react';
import { humanizeOption, type OperationSpec, type ParameterSchema } from '../../shared/operations';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';

interface Props {
  readonly operation: OperationSpec;
}

export function ParameterForm({ operation }: Props) {
  const columns = useKensaStore((s) => s.slice?.columns ?? []);
  const [values, setValues] = useState<Record<string, unknown>>(() => initialValues(operation));

  const setValue = (key: string, value: unknown) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const preview = () => {
    postMessage({
      type: 'previewOperation',
      operationId: operation.id,
      parameters: values
    });
  };

  const apply = () => {
    postMessage({
      type: 'applyOperation',
      operationId: operation.id,
      parameters: values
    });
  };

  return (
    <div className="kensa-param-form">
      {operation.parameters.map((param) => (
        <div className="kensa-param" key={param.key}>
          <label className="kensa-param-label">{param.label}</label>
          {renderField(param, values[param.key], (v) => setValue(param.key, v), columns)}
          {param.description && <div className="kensa-param-desc">{param.description}</div>}
        </div>
      ))}
      <div className="kensa-param-actions">
        <button type="button" className="kensa-btn" onClick={preview}>
          Preview
        </button>
        <button type="button" className="kensa-btn kensa-btn-primary" onClick={apply}>
          Apply
        </button>
      </div>
    </div>
  );
}

function initialValues(operation: OperationSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of operation.parameters) {
    if (p.defaultValue !== undefined) out[p.key] = p.defaultValue;
    else if (p.kind === 'columnMulti') out[p.key] = [];
  }
  return out;
}

function renderField(
  param: ParameterSchema,
  value: unknown,
  onChange: (v: unknown) => void,
  columns: ReadonlyArray<{ name: string; index: number; dtype: string }>
): React.ReactNode {
  switch (param.kind) {
    case 'column':
      return (
        <select
          className="kensa-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— select column —</option>
          {columns.map((c) => (
            <option key={c.index} value={c.name}>
              {c.name} ({c.dtype})
            </option>
          ))}
        </select>
      );
    case 'columnMulti': {
      const arr = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="kensa-multicol">
          {columns.map((c) => {
            const checked = arr.includes(c.name);
            return (
              <label key={c.index} className="kensa-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    if (e.target.checked) onChange([...arr, c.name]);
                    else onChange(arr.filter((x) => x !== c.name));
                  }}
                />
                <span>{c.name}</span>
              </label>
            );
          })}
        </div>
      );
    }
    case 'string':
      return (
        <input
          type="text"
          className="kensa-input"
          value={String(value ?? '')}
          placeholder={param.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          type="number"
          className="kensa-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      );
    case 'enum':
      return (
        <select
          className="kensa-input"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        >
          {(param.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {param.optionLabels?.[opt] ?? humanizeOption(opt)}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <label className="kensa-checkbox">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{param.placeholder ?? ''}</span>
        </label>
      );
    case 'code':
      return (
        <textarea
          className="kensa-input kensa-textarea"
          value={String(value ?? '')}
          placeholder={param.placeholder ?? ''}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
        />
      );
    default:
      return null;
  }
}
