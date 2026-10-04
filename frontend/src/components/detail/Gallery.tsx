// The photo half of the detail popup (D-042, D-046): one photo at a time, flicked
// with the arrows under it (←/→ are handled by the dialog), and zoomable with a
// trackpad pinch so a number plate can be read.

import { useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { openWindow } from '@/lib/window'

interface Props {
  images: string[]
  index: number
  onStep: (by: number) => void
}

export function Gallery({ images, index, onStep }: Props) {
  const src = images[index]
  // Same footprint without photos, so the popup doesn't change size when
  // flicking on to a listing that has none.
  if (!src) {
    return (
      <div className="flex min-h-0 items-center justify-center rounded bg-muted text-sm text-muted-foreground">
        No photos
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-col gap-2">
      {/* Keyed on the photo so a new photo starts unzoomed. */}
      <ZoomableImage key={src} src={src} />
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" disabled={images.length < 2} onClick={() => onStep(-1)} title="Previous photo (←)">
          <ChevronLeftIcon />
        </Button>
        <Button variant="outline" size="icon-sm" disabled={images.length < 2} onClick={() => onStep(1)} title="Next photo (→)">
          <ChevronRightIcon />
        </Button>
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {index + 1} / {images.length}
        </span>
        <span className="truncate text-xs text-muted-foreground">· pinch to zoom, drag to move</span>
        <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => openWindow(src)}>
          Full size ↗
        </Button>
      </div>
    </div>
  )
}

const MAX_SCALE = 8

/** Scale plus the top-left offset of the scaled image, in box pixels. */
interface View {
  scale: number
  x: number
  y: number
}

const UNZOOMED: View = { scale: 1, x: 0, y: 0 }

/** Safari's pinch event; it isn't in lib.dom. */
interface GestureEvent extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

function ZoomableImage({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>(UNZOOMED)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })
  const drag = useRef<{ lastX: number; lastY: number } | null>(null)

  // Keep the scale in range and the image covering the box, so panning can't
  // lose it off an edge.
  const fit = (v: View): View => {
    const el = box.current
    if (!el) return v
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale))
    const w = el.clientWidth
    const h = el.clientHeight
    return {
      scale,
      x: Math.min(0, Math.max(w - w * scale, v.x)),
      y: Math.min(0, Math.max(h - h * scale, v.y)),
    }
  }

  // Zoom by `factor` keeping the point under the pointer (client coords) still.
  const zoomAt = (v: View, factor: number, clientX: number, clientY: number): View => {
    const rect = box.current!.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const scale = Math.min(MAX_SCALE, Math.max(1, v.scale * factor))
    const k = scale / v.scale
    return fit({ scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k })
  }

  // Trackpad listeners go on natively: React's wheel handler is passive, so it
  // can't stop the browser zooming the whole page on a pinch.
  useEffect(() => {
    const el = box.current
    if (!el) return
    let gestureStartScale: number | null = null

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      // Chrome and Firefox report a pinch as ctrl+wheel. Safari sends gesture
      // events instead; ignore any wheel it sends mid-gesture so it can't
      // zoom twice.
      if (event.ctrlKey) {
        if (gestureStartScale !== null) return
        const factor = Math.exp(-event.deltaY * 0.01)
        setView((v) => zoomAt(v, factor, event.clientX, event.clientY))
      } else {
        // Two-finger scroll pans once zoomed in.
        setView((v) => (v.scale === 1 ? v : fit({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY })))
      }
    }
    const onGestureStart = (event: Event) => {
      event.preventDefault()
      gestureStartScale = viewRef.current.scale
    }
    const onGestureChange = (event: Event) => {
      event.preventDefault()
      const g = event as GestureEvent
      const target = (gestureStartScale ?? 1) * g.scale
      setView((v) => zoomAt(v, target / v.scale, g.clientX, g.clientY))
    }
    const onGestureEnd = (event: Event) => {
      event.preventDefault()
      gestureStartScale = null
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
    }
    // fit/zoomAt only read the box ref, so the listeners never go stale.
  }, [])

  const zoomed = view.scale > 1

  return (
    <div
      ref={box}
      className="relative min-h-0 flex-1 touch-none overflow-hidden rounded bg-muted select-none"
      style={{ cursor: zoomed ? 'grab' : undefined }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { lastX: event.clientX, lastY: event.clientY }
      }}
      onPointerMove={(event) => {
        const d = drag.current
        if (!d) return
        const dx = event.clientX - d.lastX
        const dy = event.clientY - d.lastY
        d.lastX = event.clientX
        d.lastY = event.clientY
        setView((v) => (v.scale === 1 ? v : fit({ ...v, x: v.x + dx, y: v.y + dy })))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-contain"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, transformOrigin: '0 0' }}
      />
      {zoomed && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute top-2 right-2"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setView(UNZOOMED)}
        >
          Reset zoom
        </Button>
      )}
    </div>
  )
}
