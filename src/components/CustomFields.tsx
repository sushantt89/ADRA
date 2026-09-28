import type { CustomField, ExtraValue } from '../db/types'
import { fmtDate } from '../lib/format'

export function CustomFieldInput({ field, value, onChange }: { field: CustomField; value: ExtraValue | undefined; onChange: (v: ExtraValue) => void }) {
  const label = `${field.label}${field.required ? ' *' : ''}${field.restricted ? ' (restricted)' : ''}`
  if (field.type === 'yesno') {
    return (
      <label className="check">
        <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} /> {label}
      </label>
    )
  }
  return (
    <label className="field">
      <span>{label}</span>
      {field.type === 'select' ? (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : (
        <input
          type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
          value={String(value ?? '')}
          onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        />
      )}
    </label>
  )
}

export function displayExtra(field: CustomField, v: ExtraValue | undefined): string {
  if (v === undefined || v === '') return '—'
  if (field.type === 'yesno') return v ? 'Yes' : 'No'
  if (field.type === 'date') return fmtDate(String(v))
  return String(v)
}

export function isEmptyExtra(field: CustomField, v: ExtraValue | undefined) {
  return field.type === 'yesno' ? false : v === undefined || v === ''
}
