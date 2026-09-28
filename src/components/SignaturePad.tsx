import { useEffect, useRef } from 'react'

/** Finger / mouse / stylus signature capture. Returns a PNG data URL ('' when cleared). */
export default function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useEffect(() => {
    const c = canvas.current!
    const ctx = c.getContext('2d')!
    const ratio = window.devicePixelRatio || 1
    c.width = c.offsetWidth * ratio
    c.height = c.offsetHeight * ratio
    ctx.scale(ratio, ratio)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1c2421'
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, c.offsetWidth, c.offsetHeight)
      img.src = value
    }
    // only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  return (
    <div className="sig">
      <canvas
        ref={canvas}
        className="sig-canvas"
        aria-label="Signature box: sign with finger, stylus or mouse"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          const ctx = canvas.current!.getContext('2d')!
          const [x, y] = pos(e)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x + 0.1, y + 0.1)
          ctx.stroke()
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const ctx = canvas.current!.getContext('2d')!
          const [x, y] = pos(e)
          ctx.lineTo(x, y)
          ctx.stroke()
          dirty.current = true
        }}
        onPointerUp={() => {
          drawing.current = false
          if (dirty.current) onChange(canvas.current!.toDataURL('image/png'))
        }}
      />
      <div className="sig-foot">
        <span className="muted small">Client signs above</span>
        <button
          type="button"
          className="btn btn-small btn-ghost"
          onClick={() => {
            const c = canvas.current!
            c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
            dirty.current = false
            onChange('')
          }}
        >
          Clear
        </button>
      </div>
    </div>
  )
}
