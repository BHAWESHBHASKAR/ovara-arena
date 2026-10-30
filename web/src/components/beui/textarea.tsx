import { cn } from '@/lib/utils'
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn('w-full resize-none rounded-lg bg-black/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 ring-1 ring-white/10 outline-none transition focus:ring-2 focus:ring-accent/70 disabled:opacity-50', className)} {...props} />
}
