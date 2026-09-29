import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getPresets } from '../db/db'
import { hasFilters, recordServices, searchClients, today, uuid, voidService } from '../db/repo'
import type { Client, Household, SearchFilters } from '../db/types'
import { useCan, useSession, useToast } from '../lib/context'
import { age, fmtDate, fullName } from '../lib/format'

export default function SearchPage() {
  const navigate = useNavigate()
  const can = useCan()
  const toast = useToast()
  const { session } = useSession()
  const presets = useLiveQuery(() => getPresets(), []) ?? []
  const quick = presets[0]
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<SearchFilters>({})
  const [showFilters, setShowFilters] = useState(false)
  const [cursor, setCursor] = useState(0)

  const clients = useLiveQuery(() => db.clients.toArray(), []) ?? []
  const households = useLiveQuery(() => db.households.toArray(), []) ?? []
  const saved = useLiveQuery(() => db.savedSearches.toArray(), []) ?? []
  const lastVisit = useLiveQuery(async () => {
    const map = new Map<string, string>()
    await db.services.orderBy('date').each((s) => {
      if (!s.deleted) map.set(s.clientId, s.date)
    })
    return map
  }, [])

  const hhMap = useMemo(() => new Map(households.map((h) => [h.id, h])), [households])
  const hits = useMemo(() => searchClients(q, clients, hhMap, filters, lastVisit), [q, clients, hhMap, filters, lastVisit])
  const recent = useMemo(
    () =>
      [...clients]
        .filter((c) => !c.deleted)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
        .map((c) => ({ client: c, household: hhMap.get(c.householdId), reason: '' })),
    [clients, hhMap],
  )
  const options = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort()
    const live = clients.filter((c) => !c.deleted)
    return {
      suburbs: uniq(households.map((h) => h.suburb)),
      incomes: uniq(live.map((c) => c.incomeSource)),
      cultures: uniq(live.map((c) => c.culturalBackground)),
    }
  }, [clients, households])

  const searching = !!q.trim() || hasFilters(filters)
  const rows = searching ? hits : recent
  const setF = <K extends keyof SearchFilters>(k: K, v: SearchFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v || undefined }))
    setCursor(0)
  }
  // Swipe right = quick service for this person, swipe left = for the whole household
  const swipeRecord = async (c: Client, scope: 'person' | 'household') => {
    if (!quick) return
    const targets = scope === 'household' ? clients.filter((m) => m.householdId === c.householdId && !m.deleted) : [c]
    const rows = await recordServices(
      { date: today(), type: quick.type, supportMethod: quick.supportMethod, value: quick.value, quantity: quick.quantity, notes: 'Recorded by swipe' },
      targets,
      session,
    )
    toast({
      text: `${quick.label} recorded for ${targets.length > 1 ? `${c.lastName} household (${targets.length})` : `${c.firstName} ${c.lastName}`}`,
      action: {
        label: 'Undo',
        run: async () => {
          for (const r of rows) await voidService(r.id, 'Undone immediately after entry', session)
          toast({ text: 'Undone' })
        },
      },
    })
  }

  const activeCount = Object.values(filters).filter((v) => v !== undefined && v !== '' && v !== false).length

  return (
    <div className="page">
      <div className="search-hero">
        <input
          id="search"
          data-tour="search"
          className="search-input"
          autoFocus
          value={q}
          placeholder="Search name, DOB (dd/mm/yyyy), phone, address, client ID, CRN or Medicare no…"
          onChange={(e) => {
            setQ(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, rows.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter' && rows[cursor]) {
              navigate(`/client/${rows[cursor].client.id}`)
            }
          }}
          aria-label="Search clients"
        />
        <button className={`btn btn-lg ${showFilters || activeCount ? 'btn-on' : ''}`} onClick={() => setShowFilters((x) => !x)} aria-expanded={showFilters}>
          Filters{activeCount ? ` (${activeCount})` : ''}
        </button>
        <Link to={q.trim() ? `/new?name=${encodeURIComponent(q.trim())}` : '/new'} className="btn btn-primary btn-lg">
          + New client
        </Link>
      </div>

      {showFilters && (
        <div className="card filters-panel">
          <div className="chips">
            <Chip on={!!filters.alert} onClick={() => setF('alert', !filters.alert)}>
              Has alert
            </Chip>
            <Chip on={!!filters.interpreter} onClick={() => setF('interpreter', !filters.interpreter)}>
              Needs interpreter
            </Chip>
            {can('viewRestricted') && (
              <Chip on={!!filters.disability} onClick={() => setF('disability', !filters.disability)}>
                Disability
              </Chip>
            )}
            <Chip on={filters.visitedDays === 30} onClick={() => setF('visitedDays', filters.visitedDays === 30 ? undefined : 30)}>
              Visited in last 30 days
            </Chip>
          </div>
          <div className="grid">
            <label className="field">
              <span>Suburb</span>
              <select value={filters.suburb ?? ''} onChange={(e) => setF('suburb', e.target.value)}>
                <option value="">Any</option>
                {options.suburbs.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Income source</span>
              <select value={filters.incomeSource ?? ''} onChange={(e) => setF('incomeSource', e.target.value)}>
                <option value="">Any</option>
                {options.incomes.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Cultural background</span>
              <select value={filters.culturalBackground ?? ''} onChange={(e) => setF('culturalBackground', e.target.value)}>
                <option value="">Any</option>
                {options.cultures.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="btn btn-small btn-ghost" onClick={() => setFilters({})} disabled={!activeCount}>
              Clear filters
            </button>
            <button
              className="btn btn-small"
              disabled={!searching}
              onClick={async () => {
                const name = window.prompt('Name this saved search', q.trim() || 'My search')
                if (!name) return
                await db.savedSearches.add({ id: uuid(), name, query: q, filters })
                toast({ text: `Saved "${name}"` })
              }}
            >
              Save this search
            </button>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="saved-searches">
          <span className="muted small">Saved:</span>
          {saved.map((s) => (
            <span key={s.id} className="saved-chip">
              <button
                className="chip"
                onClick={() => {
                  setQ(s.query)
                  setFilters(s.filters)
                  setShowFilters(hasFilters(s.filters))
                }}
              >
                {s.name}
              </button>
              <button className="chip-x" aria-label={`Delete saved search ${s.name}`} onClick={() => db.savedSearches.delete(s.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="muted small hint">
        Spelling doesn't need to be exact: "Jon Smyth" finds "John Smith".{' '}
        <span className="mobile-only-inline">
          Swipe a person right to record {quick ? `"${quick.label}"` : 'the first service'} for them, or left for their whole household.
        </span>
        <span className="desktop-only-inline">
          On a touch screen, swipe a person right to record {quick ? `"${quick.label}"` : 'the first service'} for them, or left for their whole household. Shortcuts:{' '}
          <kbd>/</kbd> search · <kbd>Alt</kbd>+<kbd>N</kbd> new client · <kbd>↑</kbd>
          <kbd>↓</kbd> <kbd>Enter</kbd> open · <kbd>Alt</kbd>+<kbd>L</kbd> lock.
        </span>
      </p>

      <h2 className="section-title">{searching ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : clients.length ? 'Recently updated' : ''}</h2>

      {!clients.length && (
        <div className="empty card">
          <p>No clients on this device yet.</p>
          <p className="muted">
            Register a new client
            {can('admin') ? (
              <>
                , or go to <Link to="/settings">Device</Link> and load demo data to try the app
              </>
            ) : (
              ''
            )}
            .
          </p>
        </div>
      )}

      {searching && !hits.length && clients.length > 0 && (
        <div className="empty card">
          <p>No match on this device.</p>
          {q.trim() && (
            <Link to={`/new?name=${encodeURIComponent(q.trim())}`} className="btn btn-primary">
              Register "{q.trim()}" as a new client
            </Link>
          )}
        </div>
      )}

      <ul className="results">
        {rows.map((r, i) => (
          <ResultRow
            key={r.client.id}
            client={r.client}
            household={r.household}
            reason={r.reason}
            active={i === cursor && searching}
            lastVisit={lastVisit?.get(r.client.id)}
            quickLabel={quick?.label}
            onSwipe={(scope) => swipeRecord(r.client, scope)}
          />
        ))}
      </ul>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  )
}

const SWIPE_AT = 110

function ResultRow({
  client: c,
  household: h,
  reason,
  active,
  lastVisit,
  quickLabel,
  onSwipe,
}: {
  client: Client
  household?: Household
  reason: string
  active: boolean
  lastVisit?: string
  quickLabel?: string
  onSwipe: (scope: 'person' | 'household') => void
}) {
  const a = age(c.dob)
  const [dx, setDx] = useState(0)
  const drag = useRef<{ x: number; y: number; id: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  return (
    <li
      className="swipe-row"
      onPointerDown={(e) => {
        if (e.button !== 0 || !quickLabel) return
        drag.current = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const mx = e.clientX - d.x
        const my = e.clientY - d.y
        if (!d.moved) {
          if (Math.abs(mx) < 10 || Math.abs(mx) < Math.abs(my)) return
          d.moved = true
          e.currentTarget.setPointerCapture(d.id)
        }
        setDx(Math.max(-200, Math.min(200, mx)))
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d?.moved) {
          suppressClick.current = true
          if (dx >= SWIPE_AT) onSwipe('person')
          else if (dx <= -SWIPE_AT) onSwipe('household')
        }
        setDx(0)
      }}
      onPointerCancel={() => {
        drag.current = null
        setDx(0)
      }}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault()
          e.stopPropagation()
          suppressClick.current = false
        }
      }}
    >
      {dx !== 0 && (
        <div className="swipe-bg" aria-hidden>
          <span className={dx >= SWIPE_AT ? 'ready' : ''}>{dx > 0 ? `✓ ${quickLabel}` : ''}</span>
          <span className={dx <= -SWIPE_AT ? 'ready' : ''}>{dx < 0 ? `Household ✓` : ''}</span>
        </div>
      )}
      <Link to={`/client/${c.id}`} className={`result ${active ? 'active' : ''}`} style={dx ? { transform: `translateX(${dx}px)` } : undefined} draggable={false}>
        <div className="result-main">
          <div className="result-name">
            {fullName(c)} {c.riskFlag && <span className="tag tag-risk">Alert</span>}
            {c.interpreterNeeded && <span className="tag">Interpreter</span>}
            {c.syncStatus === 'pending' && <span className="tag tag-warn">Not synced</span>}
          </div>
          <div className="muted small">
            {c.clientNo} · DOB {fmtDate(c.dob)}
            {a !== null ? ` (${a})` : ''} · {c.phone || 'no phone'}
          </div>
        </div>
        <div className="result-side small">
          <div>{h ? `${h.address}${h.address ? ', ' : ''}${h.suburb}` : ''}</div>
          <div className="muted">
            {c.relationship} in {h?.name ?? 'household'}
            {lastVisit ? ` · last visit ${fmtDate(lastVisit)}` : ''}
            {c.site ? ` · ${c.site}` : ''}
          </div>
        </div>
        {reason && <span className="tag tag-soft">{reason}</span>}
      </Link>
    </li>
  )
}
