export function fmtDate(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })
}

export function age(dob: string): number | null {
  if (!dob) return null
  const b = new Date(dob)
  const n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--
  return a
}

export function money(n: number): string {
  return n ? `$${n.toLocaleString('en-AU', { maximumFractionDigits: 2 })}` : ''
}

export function fullName(c: { firstName: string; lastName: string; preferredName?: string }): string {
  const pref = c.preferredName && c.preferredName !== c.firstName ? ` (${c.preferredName})` : ''
  return `${c.firstName} ${c.lastName}${pref}`
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v)
    // Stop spreadsheet formula injection from typed-in text
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n')
}

export function download(filename: string, content: string | Blob, type = 'text/csv') {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
