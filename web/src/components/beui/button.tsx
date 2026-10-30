import { motion, type HTMLMotionProps } from 'motion/react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-indigo-500 shadow-[0_0_0_1px_rgba(99,102,241,.5),0_8px_24px_-8px_rgba(99,102,241,.6)]',
  secondary: 'bg-white/[0.06] text-zinc-100 hover:bg-white/[0.1] ring-1 ring-white/10',
  ghost: 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]',
  danger: 'bg-red-500/10 text-red-300 ring-1 ring-red-500/30 hover:bg-red-500/20',
  success: 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25',
}
export interface ButtonProps extends HTMLMotionProps<'button'> { variant?: Variant; size?: 'sm' | 'md' }
export function Button({ className, variant = 'secondary', size = 'md', disabled, ...props }: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.96 }}
      whileHover={disabled ? undefined : { y: -1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      disabled={disabled}
      className={cn('inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed select-none',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm', variants[variant], className)}
      {...props}
    />
  )
}
