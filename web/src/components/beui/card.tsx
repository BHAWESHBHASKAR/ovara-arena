import { cn } from '@/lib/utils'
export function Card({ title, right, className, children }: { title?: React.ReactNode; right?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn('rounded-xl bg-panel ring-1 ring-line', className)}>
      {title && <header className="flex items-center justify-between border-b border-line px-4 py-2.5"><h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>{right}</header>}
      <div className="p-4">{children}</div>
    </section>
  )
}
