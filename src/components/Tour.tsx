import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { db } from '../db/db'
import type { Session } from '../db/types'
import { tourSteps, type TourId, type TourStep } from '../lib/tours'

// Spotlight walkthrough: dims the screen, highlights one part of the app at a
// time and explains it. Finished or skipped tours are remembered per person.

interface TourCtx {
  start: (id: TourId) => void
  /** Start a tour only if this person hasn't seen it yet. */
  autoStart: (id: TourId) => void
  active: TourId | null
}

const Ctx = createContext<TourCtx>({ start: () => {}, autoStart: () => {}, active: null })
export const useTour = () => useContext(Ctx)

/** Call from a page to show its tips the first time someone opens it. */
export function useAutoTour(id: TourId, ready = true) {
  const { autoStart } = useTour()
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => autoStart(id), 400)
    return () => clearTimeout(t)
  }, [id, ready, autoStart])
}

export function TourProvider({ session, children }: { session: Session; children: ReactNode }) {
  const [active, setActive] = useState<TourId | null>(null)
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const activeRef = useRef<TourId | null>(null)

  const start = useCallback(
    (id: TourId) => {
      activeRef.current = id
      setSteps(tourSteps(id, session.role, session.userName))
      setIndex(0)
      setActive(id)
    },
    [session.role, session.userName],
  )

  const autoStart = useCallback(
    async (id: TourId) => {
      if (activeRef.current) return
      const user = await db.users.get(session.userId)
      if (!user || user.toursDone?.includes(id)) return
      if (!activeRef.current) start(id)
    },
    [session.userId, start],
  )

  const finish = useCallback(async () => {
    const id = activeRef.current
    activeRef.current = null
    setActive(null)
    if (!id) return
    const user = await db.users.get(session.userId)
    if (user && !user.toursDone?.includes(id)) await db.users.update(user.id, { toursDone: [...(user.toursDone ?? []), id] })
  }, [session.userId])

  return (
    <Ctx.Provider value={{ start, autoStart, active }}>
      {children}
      {active && steps[index] && (
        <TourOverlay
          step={steps[index]}
          index={index}
          total={steps.length}
          onBack={() => setIndex((i) => Math.max(0, i - 1))}
          onNext={() => (index + 1 >= steps.length ? finish() : setIndex(index + 1))}
          onSkip={finish}
        />
      )}
    </Ctx.Provider>
  )
}

interface Box {
  top: number
  left: number
  width: number
  height: number
}

function TourOverlay({ step, index, total, onBack, onNext, onSkip }: { step: TourStep; index: number; total: number; onBack: () => void; onNext: () => void; onSkip: () => void }) {
  const [box, setBox] = useState<Box | null>(null)
  const [card, setCard] = useState<{ top: number; left: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)

  // Find and follow the highlighted element
  useLayoutEffect(() => {
    let raf = 0
    const visible = (e: HTMLElement) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    }
    const find = (t: string) => ([...document.querySelectorAll(`[data-tour="${t}"]`)] as HTMLElement[]).find(visible) ?? null
    // On phones, items that live in the Menu sheet are pointed out on the Menu tab instead
    const IN_MENU = ['nav-reports', 'nav-duplicates', 'nav-admin', 'help', 'lock']
    const el = step.target ? (find(step.target) ?? (IN_MENU.includes(step.target) ? find('menu') : null)) : null
    if (el && visible(el)) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
    let prev = ''
    const measure = () => {
      let next: Box | null = null
      if (el && el.isConnected && visible(el)) {
        const r = el.getBoundingClientRect()
        const pad = 6
        next = { top: Math.round(r.top - pad), left: Math.round(r.left - pad), width: Math.round(r.width + pad * 2), height: Math.round(r.height + pad * 2) }
      }
      // Only re-render when the element actually moved
      const key = JSON.stringify(next)
      if (key !== prev) {
        prev = key
        setBox(next)
      }
      raf = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(raf)
  }, [step])

  // Place the card next to the highlight, keeping it on screen
  useLayoutEffect(() => {
    const c = cardRef.current
    if (!c) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cw = c.offsetWidth
    const ch = c.offsetHeight
    const gap = 14
    if (!box) {
      setCard({ top: Math.max(16, (vh - ch) / 2), left: Math.max(16, (vw - cw) / 2) })
      return
    }
    const fits = {
      bottom: box.top + box.height + gap + ch < vh - 8,
      top: box.top - gap - ch > 8,
      right: box.left + box.width + gap + cw < vw - 8,
      left: box.left - gap - cw > 8,
    }
    const order = [step.placement ?? 'bottom', 'bottom', 'top', 'right', 'left'] as const
    const place = order.find((p) => fits[p]) ?? 'bottom'
    let top = 0
    let left = 0
    if (place === 'bottom' || place === 'top') {
      top = place === 'bottom' ? box.top + box.height + gap : box.top - gap - ch
      left = box.left + box.width / 2 - cw / 2
    } else {
      left = place === 'right' ? box.left + box.width + gap : box.left - gap - cw
      top = box.top + box.height / 2 - ch / 2
    }
    setCard({ top: Math.min(Math.max(8, top), vh - ch - 8), left: Math.min(Math.max(8, left), vw - cw - 8) })
  }, [box, step])

  useEffect(() => {
    nextRef.current?.focus()
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onSkip()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onBack()
      }
      e.stopPropagation()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onNext, onBack, onSkip, index])

  const last = index + 1 >= total
  return (
    <div className="tour-layer" aria-live="polite">
      {/* Blocks clicks on the page while the tour is open */}
      <div className={`tour-dim ${box ? 'clear' : ''}`} onClick={(e) => e.stopPropagation()} />
      {box && <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={card ? { top: card.top, left: card.left } : { visibility: 'hidden', top: 0, left: 0 }}
      >
        <div className="tour-count">
          {index + 1} of {total}
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-dots" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i === index ? 'on' : i < index ? 'done' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button className="btn btn-small btn-ghost" onClick={onSkip}>
            {last ? 'Close' : 'Skip tour'}
          </button>
          <span className="grow" />
          {index > 0 && (
            <button className="btn btn-small" onClick={onBack}>
              Back
            </button>
          )}
          <button ref={nextRef} className="btn btn-small btn-primary" onClick={onNext}>
            {last ? 'Finish' : index === 0 && !step.target ? 'Show me' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
