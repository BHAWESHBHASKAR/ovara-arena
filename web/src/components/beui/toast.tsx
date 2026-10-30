import { AnimatePresence, motion } from 'motion/react'
import { createContext, useCallback, useContext, useState } from 'react'
import { cn } from '@/lib/utils'
type Kind = 'ok' | 'err' | 'info'
type T = { id: number; msg: string; kind: Kind }
const Ctx = createContext<(msg: string, kind?: Kind) => void>(() => {})
export const useToast = () => useContext(Ctx)
let n = 0
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([])
  const push = useCallback((msg: string, kind: Kind = 'info') => {
    const id = ++n
    setItems(s => [...s, { id, msg, kind }])
    setTimeout(() => setItems(s => s.filter(t => t.id !== id)), kind === 'err' ? 7000 : 4000)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
        <AnimatePresence>
          {items.map(t => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 40 }}
              className={cn('pointer-events-auto rounded-lg bg-panel/95 px-3 py-2 text-sm shadow-xl ring-1 backdrop-blur',
                t.kind === 'err' ? 'ring-red-500/40 text-red-200' : t.kind === 'ok' ? 'ring-emerald-500/40 text-emerald-100' : 'ring-white/10 text-zinc-200')}>
              {t.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  )
}
