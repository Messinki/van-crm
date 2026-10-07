// A textarea that highlights the keywords from lib/keywords.ts (D-056).
//
// A <textarea> can't colour parts of its own text, so a div sits behind it with
// the same border, padding, font and wrapping, rendering the same text with
// <mark>s around the matches. The backdrop's text is transparent — only the marks'
// yellow shows, through the textarea's transparent background — so the visible
// text, caret and selection are all the textarea's own. Scrolling is mirrored onto
// the backdrop, and both keep a stable scrollbar gutter so they wrap at the same
// width.

import { useLayoutEffect, useMemo, useRef } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { keywordSegments } from '@/lib/keywords'
import { cn } from '@/lib/utils'

// Box metrics shared by both layers — keep in step with ui/textarea.tsx.
const BOX = 'rounded-lg border px-2.5 py-2 text-base md:text-sm [scrollbar-gutter:stable]'

export function HighlightTextarea({
  value,
  className,
  onScroll,
  ...props
}: Omit<React.ComponentProps<'textarea'>, 'value' | 'ref'> & { value: string }) {
  const box = useRef<HTMLTextAreaElement>(null)
  const backdrop = useRef<HTMLDivElement>(null)
  const segments = useMemo(() => keywordSegments(value), [value])

  const sync = () => {
    if (!box.current || !backdrop.current) return
    backdrop.current.scrollTop = box.current.scrollTop
    backdrop.current.scrollLeft = box.current.scrollLeft
  }
  // Typing can scroll the box without a scroll event reaching us first.
  useLayoutEffect(sync, [value])

  return (
    <div className="relative">
      <div
        ref={backdrop}
        aria-hidden
        className={cn(
          BOX,
          'pointer-events-none absolute inset-0 overflow-hidden border-transparent break-words whitespace-pre-wrap text-transparent dark:bg-input/30',
        )}
      >
        {segments.map((s, i) =>
          s.kind ? (
            <mark key={i} className="rounded-sm bg-yellow-200 text-transparent dark:bg-yellow-400/35">
              {s.text}
            </mark>
          ) : (
            s.text
          ),
        )}
        {/* A trailing newline needs something after it to take up its line. */}
        {value.endsWith('\n') ? ' ' : null}
      </div>
      <Textarea
        ref={box}
        value={value}
        className={cn(BOX, 'relative bg-transparent dark:bg-transparent', className)}
        onScroll={(e) => {
          sync()
          onScroll?.(e)
        }}
        {...props}
      />
    </div>
  )
}
