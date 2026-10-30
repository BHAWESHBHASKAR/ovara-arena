import { motion } from 'motion/react'
import { useId } from 'react'
import { cn } from '@/lib/utils'
export function SegmentedControl<T extends string>({ options, value, onChange, disabled, className }: { options: { value: T; label: string }[]; value: T | null; onChange: (v: T) => void; disabled?: boolean; className?: string }) {
  const id = useId()
  return (
    <div className={cn('relative inline-flex rounded-lg bg-black/40 p-0.5 ring-1 ring-white/10', disabled && 'opacity-50', className)}>
      {options.map(o => (
        <button key={o.value} disabled={disabled} onClick={() => onChange(o.value)}
          className={cn('relative z-10 h-7 flex-1 px-3 text-xs font-medium transition-colors', value === o.value ? 'text-white' : 'text-zinc-400 hover:text-zinc-200')}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 -z-10 rounded-md bg-accent" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}
export const Tabs = SegmentedControl
