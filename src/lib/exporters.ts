import type { DocketBranding } from '../db/types'
import type { DocketData } from './docketData'
import { logoSrc } from './branding'
import { download, money, toCsv } from './format'
import type { ReportSnapshot } from './reportData'

// File exports: CSV, Excel and real PDF files. The PDF and Excel libraries
// are loaded only when someone exports, so the app stays quick to open.

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  download(filename, toCsv(rows))
}

export async function excelBlob(summary: Record<string, unknown>[], detail: Record<string, unknown>[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  const toSheet = (rows: Record<string, unknown>[]) => {
    if (!rows.length) return [[{ value: 'No data' }]]
    const headers = Object.keys(rows[0])
    return [
      headers.map((h) => ({ value: h, fontWeight: 'bold' as const })),
      ...rows.map((row) =>
        headers.map((h) => {
          const v = row[h]
          return v === '' || v == null ? null : typeof v === 'number' ? { value: v } : { value: String(v) }
        }),
      ),
    ]
  }
  return writeXlsxFile([
    { sheet: 'Summary', data: toSheet(summary), columns: [{ width: 34 }, { width: 30 }, { width: 22 }] },
    { sheet: 'Services', data: toSheet(detail) },
  ]).toBlob()
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [15, 95, 92]
}

function imageFormat(dataUrl: string) {
  return /^data:image\/png/i.test(dataUrl) ? 'PNG' : 'JPEG'
}

interface Logo {
  data: string
  w: number
  h: number
}

/** Loads the docket logo (the built-in ADRA logo or an uploaded one) as a data URL with its size. */
async function loadLogo(b: DocketBranding): Promise<Logo | null> {
  const src = logoSrc(b)
  if (!src) return null
  try {
    let data = src
    if (!src.startsWith('data:')) {
      const blob = await (await fetch(src)).blob()
      data = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(blob)
      })
    }
    const img = new Image()
    await new Promise((res, rej) => {
      img.onload = res
      img.onerror = rej
      img.src = data
    })
    return { data, w: img.naturalWidth, h: img.naturalHeight }
  } catch {
    return null
  }
}

/** Largest size that fits the box while keeping the logo's shape. */
function fit(l: Logo, maxW: number, maxH: number) {
  const k = Math.min(maxW / l.w, maxH / l.h)
  return { w: l.w * k, h: l.h * k }
}

/** Report as a real PDF file: header, key numbers, funder summary and every breakdown table. */
export async function reportPdfBlob(s: ReportSnapshot, orgName: string, b: DocketBranding, printedBy: string): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const accent = hexToRgb(b.colour)
  const W = doc.internal.pageSize.getWidth()
  let y = 16

  const logo = await loadLogo(b)
  if (logo) {
    const { w, h } = fit(logo, 60, 13)
    try {
      doc.addImage(logo.data, imageFormat(logo.data), 14, 9, w, h)
      y = 9 + h + 7
    } catch {
      /* unreadable logo: skip */
    }
  }
  const x0 = 14
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...accent)
  doc.text(s.title, x0, y)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(90)
  doc.text(orgName, x0, y + 6)
  const p = s.params
  doc.text(`${p.from.split('-').reverse().join('/')} to ${p.to.split('-').reverse().join('/')} · ${p.site || 'All sites'}${p.type ? ` · ${p.type}` : ''}`, x0, y + 11)
  y += 18

  // Key numbers
  const boxW = (W - 28 - 9) / 4
  s.kpis.forEach(([label, value], i) => {
    const x = 14 + i * (boxW + 3)
    doc.setFillColor(243, 246, 244).roundedRect(x, y, boxW, 18, 2, 2, 'F')
    doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...accent)
    doc.text(String(value), x + 3, y + 9)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(90)
    doc.text(label, x + 3, y + 14.5)
  })
  y += 26

  const table = (title: string, head: string[], body: (string | number)[][]) => {
    autoTable(doc, {
      startY: y,
      head: [[{ content: title, colSpan: head.length, styles: { halign: 'left', fillColor: accent, textColor: 255, fontStyle: 'bold' } }], head],
      body,
      theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 1.6, textColor: 40 },
      headStyles: { fillColor: [232, 238, 236], textColor: 40, fontStyle: 'bold' },
      columnStyles: { [head.length - 1]: { halign: 'right' } },
      margin: { left: 14, right: 14 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
  }

  table('Funder summary', ['Measure', 'Count'], s.funder)
  for (const sec of s.sections) {
    if (!sec.rows.length) continue
    table(sec.title, ['Category', sec.money ? 'Value' : sec.unit[0].toUpperCase() + sec.unit.slice(1)], sec.rows.map(([k, v]) => [k, sec.money ? money(v) || '$0' : v]))
  }

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7.5).setTextColor(130)
    doc.text(`Generated ${new Date(s.generatedAt).toLocaleString('en-AU')} by ${printedBy} · Page ${i} of ${pages}`, 14, doc.internal.pageSize.getHeight() - 8)
  }
  return doc.output('blob')
}

/** Client docket as a PDF, A4 or 80 mm receipt, following the admin's branding. */
export async function docketPdfBlob(d: DocketData, b: DocketBranding): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const receipt = b.paper === 'receipt'
  const W = receipt ? 80 : 210
  const M = receipt ? 5 : 16
  // Receipts are long and narrow: size the page to the content
  const estLines = 14 + d.members.length + d.lines.length * (receipt ? 2 : 1) + (d.instructions ? 3 : 0) + (b.showSignature ? 4 : 0)
  const doc = new jsPDF({ unit: 'mm', format: receipt ? [W, Math.max(120, estLines * 7 + 40)] : 'a4' })
  const accent = hexToRgb(b.colour)
  const fs = receipt ? 0.85 : 1
  let y = M + 2

  const logo = await loadLogo(b)
  if (logo) {
    const { w, h } = receipt ? fit(logo, 50, 14) : fit(logo, 60, 15)
    try {
      doc.addImage(logo.data, imageFormat(logo.data), receipt ? (W - w) / 2 : M, y - 2, w, h)
      y += h + 3
    } catch {
      /* skip */
    }
  }
  const tx = receipt ? W / 2 : M
  const align = receipt ? ('center' as const) : ('left' as const)
  doc.setFont('helvetica', 'bold').setFontSize(14 * fs).setTextColor(...accent)
  const sameAsLogo = logo && b.logo === 'builtin' && d.orgName.trim().toUpperCase() === 'ADRA'
  if (!sameAsLogo) doc.text(d.orgName, tx, y + 3, { align })
  else y -= 5
  doc.setFont('helvetica', 'normal').setFontSize(8.5 * fs).setTextColor(80)
  let sub = y + 8
  if (b.subtitle) {
    doc.text(b.subtitle, tx, sub, { align })
    sub += 4
  }
  doc.text(`${d.site} · Emergency relief docket`, tx, sub, { align })
  if (!receipt) {
    doc.setFont('courier', 'bold').setFontSize(14).setTextColor(20)
    doc.text(d.clientNo, W - M, y + 4, { align: 'right' })
  }
  y = Math.max(sub, y + 12) + 3
  doc.setDrawColor(...accent).setLineWidth(0.8).line(M, y, W - M, y)
  y += 7
  if (receipt) {
    doc.setFont('courier', 'bold').setFontSize(12).setTextColor(20)
    doc.text(d.clientNo, W / 2, y, { align: 'center' })
    y += 6
  }
  doc.setFont('helvetica', 'bold').setFontSize(15 * fs).setTextColor(20)
  doc.text(d.name, M, y)
  doc.setFont('helvetica', 'normal').setFontSize(9 * fs).setTextColor(80)
  doc.text(`DOB ${d.dob}${d.area ? ` · ${d.area}` : ''}`, M, y + 5)
  y += 11

  const section = (title: string, rows: string[][]) => {
    autoTable(doc, {
      startY: y,
      head: [[{ content: title.toUpperCase(), colSpan: rows[0]?.length ?? 1 }]],
      body: rows,
      theme: 'plain',
      styles: { fontSize: 9 * fs, cellPadding: receipt ? 0.8 : 1.2, textColor: 30 },
      headStyles: { textColor: accent, fontStyle: 'bold', fontSize: 8 * fs },
      margin: { left: M, right: M },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4
  }

  if (b.showHousehold) section(`Household (${d.members.length})`, d.members.map((m) => [m.name, m.relationship, m.age]))
  if (b.showServices)
    section(
      `Services provided${d.visitDate ? ` — ${d.visitDate}` : ''}`,
      d.lines.length ? d.lines.map((l) => (receipt ? [`${l.type} (${l.who})`, lineValueText(l.value)] : [l.type, l.method, l.who, lineValueText(l.value)])) : [['No services recorded']],
    )
  const facts: string[][] = []
  if (b.showEligibility) facts.push(['Next eligible from', d.nextEligible])
  if (b.showAppointment) facts.push(['Next appointment', d.nextAppointment || '____________'])
  if (facts.length) section('Next steps', facts)
  if (b.showInstructions && d.instructions) section('Instructions', [[d.instructions]])

  if (b.showSignature) {
    y += 8
    const half = (W - 2 * M - 6) / 2
    doc.setDrawColor(120).setLineWidth(0.3)
    doc.line(M, y, M + half, y)
    doc.line(M + half + 6, y, W - M, y)
    doc.setFontSize(7.5 * fs).setTextColor(100)
    doc.text('Client signature', M, y + 4)
    doc.text('Staff signature', M + half + 6, y + 4)
    y += 8
  }
  doc.setFontSize(7.5 * fs).setTextColor(110)
  doc.text(doc.splitTextToSize(`${d.issued} ${d.footer}`, W - 2 * M), M, y + 4)
  return doc.output('blob')
}

function lineValueText(v: number) {
  return money(v)
}
