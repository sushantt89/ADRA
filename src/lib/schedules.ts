import { db, getConfig } from '../db/db'
import { uuid } from '../db/repo'
import type { ReportSchedule } from '../db/types'
import { computeReport, snapshot, type ReportParams } from './reportData'

// Scheduled reports. The app checks when it opens (and every half hour while
// open) whether a weekly or monthly period has finished; if so it builds the
// report and puts it in the Reports inbox. Emailing reports needs the cloud
// server, which comes in the next stage.

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The most recent fully finished period for a schedule. */
export function lastCompletedPeriod(freq: ReportSchedule['frequency'], now = new Date()): { from: string; to: string; label: string } {
  if (freq === 'weekly') {
    // Monday–Sunday weeks
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const dow = (d.getDay() + 6) % 7 // 0 = Monday
    const end = new Date(d)
    end.setDate(d.getDate() - dow - 1) // last Sunday
    const start = new Date(end)
    start.setDate(end.getDate() - 6)
    return { from: iso(start), to: iso(end), label: `week ending ${end.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` }
  }
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 0)
  return { from: iso(start), to: iso(end), label: start.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' }) }
}

/** Generates any reports that are due. Returns the titles created. */
export async function runDueSchedules(now = new Date()): Promise<string[]> {
  const schedules = (await db.schedules.toArray()).filter((s) => s.active)
  if (!schedules.length) return []
  const due = schedules.filter((s) => s.lastPeriodEnd < lastCompletedPeriod(s.frequency, now).to)
  if (!due.length) return []

  const [config, services, clients, households] = await Promise.all([getConfig(), db.services.toArray(), db.clients.toArray(), db.households.toArray()])
  const created: string[] = []
  for (const s of due) {
    const period = lastCompletedPeriod(s.frequency, now)
    const params: ReportParams = { from: period.from, to: period.to, site: s.site, type: s.type }
    // Scheduled reports never include restricted custom fields
    const report = computeReport({ services, clients, households }, params, config, false)
    const title = `${s.name} — ${period.label}`
    await db.transaction('rw', db.reportRuns, db.schedules, async () => {
      await db.reportRuns.add({ id: uuid(), scheduleId: s.id, title, createdAt: new Date().toISOString(), read: false, snapshot: snapshot(report, title) })
      await db.schedules.update(s.id, { lastPeriodEnd: period.to })
    })
    created.push(title)
  }
  notify(created)
  return created
}

function notify(titles: string[]) {
  if (!titles.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    new Notification('Report ready', { body: titles.join('\n'), icon: `${import.meta.env.BASE_URL}pwa-192.png` })
  } catch {
    /* some browsers only allow notifications from the service worker */
  }
}
