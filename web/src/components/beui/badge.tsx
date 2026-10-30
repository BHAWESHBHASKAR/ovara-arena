import { cn } from '@/lib/utils'
export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'indigo'
const tones: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-zinc-300 ring-white/10',
  green: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  amber: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  red: 'bg-red-500/10 text-red-300 ring-red-500/30',
  indigo: 'bg-indigo-500/10 text-indigo-300 ring-indigo-500/30',
}
export function Badge({ tone = 'neutral', className, children, dot }: { tone?: Tone; className?: string; children: React.ReactNode; dot?: boolean }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}
