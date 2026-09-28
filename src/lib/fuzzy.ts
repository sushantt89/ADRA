// Fuzzy matching used by search and duplicate detection.
// Mirrors what PostgreSQL's pg_trgm extension will do on the server.

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

function trigrams(s: string): Set<string> {
  const padded = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3))
  return out
}

/** Trigram similarity 0..1 (same idea as pg_trgm's similarity()). */
export function similarity(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const ta = trigrams(na)
  const tb = trigrams(nb)
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  return shared / (ta.size + tb.size - shared)
}

/** Edit distance, used to catch small typos in short names (Jon / John). */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** How alike two single names are, 0..1, tolerant of typos and spelling variants. */
export function nameScore(a: string, b: string): number {
  const na = normalise(a)
  const nb = normalise(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.startsWith(nb) || nb.startsWith(na)) return 0.85
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length)
  return Math.max(lev, similarity(na, nb))
}
