// The rank panel: enable toggle, weight sliders, length-code ordering. Opening
// the panel with rank off turns it on — the button is how rank mode is switched
// back on after a header click handed the order back to a column.

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RANK_FACTORS, RANK_LABELS, type Rank } from '@/lib/ranking'
import { cn } from '@/lib/utils'

interface Props {
  rank: Rank
  onRankChange: (next: Rank) => void
}

export function RankPanel({ rank, onRankChange }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next && !rank.enabled) onRankChange({ ...rank, enabled: true })
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant={rank.enabled ? 'default' : 'outline'}
          size="sm"
          className={cn('h-6 rounded-full px-2.5 text-xs')}
        >
          Rank
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rank.enabled}
            onChange={(e) => onRankChange({ ...rank, enabled: e.target.checked })}
          />
          <span>Sort by rank</span>
        </label>

        <p className="mb-1 mt-3 text-xs font-medium text-muted-foreground">Weights</p>
        {RANK_FACTORS.map((factor) => (
          <div key={factor} className="flex items-center gap-2 py-0.5">
            <span className="w-16 text-xs">{RANK_LABELS[factor]}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={rank.weights[factor]}
              className="flex-1"
              onChange={(e) =>
                onRankChange({
                  ...rank,
                  weights: { ...rank.weights, [factor]: Number(e.target.value) },
                })
              }
            />
            <span className="w-7 text-right text-xs tabular-nums">{rank.weights[factor]}</span>
          </div>
        ))}

        <p className="mb-1 mt-3 text-xs font-medium text-muted-foreground">Length, best first</p>
        {rank.lengthOrder.map((code, index) => (
          <div key={code} className="flex items-center gap-1 py-0.5">
            <span className="flex-1 text-xs">
              {index + 1}. {code}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title="Move up"
              disabled={index === 0}
              onClick={() => onRankChange({ ...rank, lengthOrder: swap(rank.lengthOrder, index, index - 1) })}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              title="Move down"
              disabled={index === rank.lengthOrder.length - 1}
              onClick={() => onRankChange({ ...rank, lengthOrder: swap(rank.lengthOrder, index, index + 1) })}
            >
              ↓
            </Button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function swap(order: string[], a: number, b: number): string[] {
  const next = [...order]
  ;[next[a], next[b]] = [next[b], next[a]]
  return next
}
