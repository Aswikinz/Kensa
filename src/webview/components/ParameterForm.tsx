// Dynamic form rendered from an OperationSpec.parameters schema. Each
// parameter kind maps to a small inline component; on Apply we ship the full
// params bag to the extension host as an applyOperation message.

import { useMemo, useState } from 'react';
import { humanizeOption, type OperationSpec, type ParameterSchema } from '../../shared/operations';
import { useKensaStore } from '../state/store';
import { postMessage } from '../vscodeApi';
import { ColumnPicker } from './ColumnPicker';
import { ThemedSelect } from './ThemedSelect';

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
      // Themed searchable single-select — replaces the native `<select>`
      // that showed up as a browser-default white dropdown on dark themes.
      return (
        <ColumnPicker
          columns={columns}
          value={typeof value === 'string' ? value : ''}
          onChange={(v) => onChange(v)}
          placeholder="— select column —"
        />
      );
    case 'columnMulti':
      // Themed searchable multi-select — replaces the unsorted checkbox
      // scroll-list, which was unworkable once a dataset had 30+ columns.
      return (
        <ColumnPicker
          multi
          columns={columns}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={(v) => onChange(v)}
          placeholder="— select columns —"
        />
      );
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
      // Render via ThemedSelect (same component the Advanced Filter
      // form uses) instead of a native `<select>`. Two reasons:
      //  - On dark themes the OS option-list styling for `<select>`
      //    pops up white-on-white and was visually inconsistent with
      //    the pink-themed ColumnPicker right above it in this same
      //    form.
      //  - The trigger now matches the ColumnPicker's chrome, so
      //    "column" and "target type" rows in operations like Change
      //    Type read as a coherent pair instead of two different
      //    widget styles stacked together.
      return (
        <EnumSelect
          value={String(value ?? '')}
          onChange={(v) => onChange(v)}
          options={param.options ?? []}
          optionLabels={param.optionLabels}
        />
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

/** Themed enum dropdown. Mirrors the `<select>`-equivalent surface area
 *  but renders through `ThemedSelect` so it matches the ColumnPicker
 *  beside it. The options array is memoized because `ThemedSelect`
 *  takes a `ReadonlyArray<{value, label}>` rather than the bare
 *  string list this component stores in the operation schema. */
function EnumSelect({
  value,
  onChange,
  options,
  optionLabels
}: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly options: readonly string[];
  readonly optionLabels?: Record<string, string>;
}) {
  const opts = useMemo(
    () =>
      options.map((opt) => ({
        value: opt,
        label: optionLabels?.[opt] ?? humanizeOption(opt)
      })),
    [options, optionLabels]
  );
  return (
    <ThemedSelect
      value={value}
      options={opts}
      onChange={onChange}
      variant="form"
      placeholder="— select —"
    />
  );
}
