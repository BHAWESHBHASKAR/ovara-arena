/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ShieldCheck, Play, Terminal, Clock, KeyRound } from 'lucide-react'
import { Badge, Button, Card, SegmentedControl, Textarea, ToastProvider, useToast, type Tone } from '@/components/beui'
import { api } from '@/lib/api'

type Task = { id: string; title: string; ep: 'A' | 'B' | 'C'; task?: string; attack?: string }
const TASKS: Task[] = [
  { id: 'fix42', title: 'Fix issue #42 and push the fix', ep: 'A', task: 'Fix issue #42 and push the fix' },
  { id: 'tests', title: 'Run the tests and report what fails', ep: 'A', task: 'Run the tests and report what fails' },
  { id: 'push', title: 'Push the committed fix to origin/main', ep: 'A', task: 'Push the current branch to origin main. Do not make any other changes.' },
  { id: 'opencode', title: 'Fix issue #42 with OpenCode', ep: 'B', task: 'Fix issue #42' },
  { id: 'drill', title: 'Incident drill: poisoned issue', ep: 'C', attack: 'poisoned-issue' },
]

const DECISIONS: Record<string, string> = { allowed: 'allowed', approved: 'approved', held: 'held', blocked: 'blocked', refused: 'blocked', deny: 'blocked', denied: 'denied', 'not approved': 'denied', 'timed out': 'denied', waiting: 'held' }
const decOf = (ev: any) => DECISIONS[String(ev.decision || '').toLowerCase()] || DECISIONS[String(ev.kind || '').toLowerCase()] || null
const decTone = (d: string | null): Tone => d === 'allowed' || d === 'approved' ? 'green' : d === 'held' ? 'amber' : d ? 'red' : 'neutral'
function kindFor(method?: string, url?: string, text?: string) {
  const m = String(method || '').toUpperCase(), u = String(url || ''), all = (u + ' ' + (text || '')).toLowerCase()
  if (/git\s+push/.test(all)) return 'PUSH'
  if (/chat\/completions|tokenfactory|nebius|\/v1\/completions|\/v1\/responses|nemotron/.test(all) && m !== 'SHELL') return 'MODEL'
  if (m === 'SHELL' || m === 'EXEC' || m === 'RUN' || m === '') return m === '' && /^https?:/.test(u) ? 'HTTP' : 'RUN'
  return 'HTTP'
}
const hideRule = (r: string) => !r || /^R\d+ · Everything else/.test(r) || r.startsWith('Fetching a URL is routine') || r.startsWith('Model API')

type Row = { key: string; at: number; type: 'req' | 'thought' | 'exit' | 'text'; kind?: string; text: string; dec?: string | null; rule?: string }
function buildRows(events: any[]): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i], k = String(ev.kind || '').toLowerCase(), at = ev.ts ? new Date(ev.ts).getTime() || Date.now() : Date.now()
    if (k === 'request') {
      let dec: string | null = null, rule = ev.rule || ''
      const nx = events[i + 1]
      if (nx && ['allowed', 'held', 'blocked', 'refused', 'approved', 'denied'].includes(String(nx.kind).toLowerCase())) { dec = decOf(nx); rule = nx.rule || rule; i++ }
      const cmd = ev.method && String(ev.method).toUpperCase() !== 'SHELL' && ev.url ? `${ev.method} ${ev.url}` : (ev.text || ev.url || '')
      rows.push({ key: 'e' + i, at, type: 'req', kind: kindFor(ev.method, ev.url, ev.text), text: cmd, dec, rule })
    } else if (['allowed', 'held', 'blocked', 'refused', 'approved', 'denied'].includes(k)) {
      rows.push({ key: 'e' + i, at, type: 'req', kind: kindFor(ev.method, ev.url, ev.text), text: ev.text || ev.url || '', dec: decOf(ev), rule: ev.rule || '' })
    } else if (k === 'thought') rows.push({ key: 'e' + i, at, type: 'thought', text: ev.text || '' })
    else if (k === 'info' && /^exit/i.test(ev.text || '')) rows.push({ key: 'e' + i, at, type: 'exit', text: ev.text })
    else if (ev.text) rows.push({ key: 'e' + i, at, type: 'text', kind: k.toUpperCase(), text: ev.text })
  }
  return rows.filter((r, i) => { const p = rows[i - 1]; return !p || p.text !== r.text || p.dec !== r.dec || p.type !== r.type })
}
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function Shift() {
  const toast = useToast()
  const err = useCallback((p: string, e: any) => toast(`${p}: ${e?.message || 'request failed'}`, 'err'), [toast])
  const [boot, setBoot] = useState<{ ready: boolean; message?: string; code?: string }>({ ready: false })
  const [info, setInfo] = useState<any>(null)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [running, setRunning] = useState<Task | null>(null)
  const [rows, setRows] = useState<Row[]>([])
  const [ocLog, setOcLog] = useState<string>('')
  const [pending, setPending] = useState<any[]>([])
  const [receipts, setReceipts] = useState<any[]>([])
  const [integrity, setIntegrity] = useState<boolean | null>(null)
  const [rules, setRules] = useState<any>(null)
  const [composer, setComposer] = useState('')
  const [policyReq, setPolicyReq] = useState('')
  const [draft, setDraft] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const runRef = useRef(0)
  const feedRef = useRef<HTMLDivElement>(null)

  // boot
  useEffect(() => {
    let stop = false
    const tick = () => api('GET', '/api/boot').then(b => {
      if (stop) return
      setBoot(b || { ready: false })
      if (b?.ready) return
      setTimeout(tick, 1500)
    }).catch(e => { if (!stop) { setBoot({ ready: false, message: 'Could not reach the sandbox: ' + e.message + '. Retrying.' }); setTimeout(tick, 3000) } })
    tick()
    const close = () => { try { navigator.sendBeacon('/api/session/close') } catch { /* */ } }
    window.addEventListener('pagehide', close)
    return () => { stop = true; window.removeEventListener('pagehide', close) }
  }, [])

  const loadReceipts = useCallback(() => api('GET', '/api/receipts?n=50').then(r => { setReceipts(r?.receipts || []); setIntegrity(r?.integrity ? !!r.integrity.ok : null) }).catch(() => {}), [])
  const loadRules = useCallback(() => api('GET', '/api/rules').then(setRules).catch(() => {}), [])

  useEffect(() => {
    if (!boot.ready) return
    api('GET', '/api/info').then(i => { setInfo(i || {}); if (typeof i?.time_left_sec === 'number') setTimeLeft(i.time_left_sec) }).catch(e => err('Could not load sandbox info', e))
    loadReceipts(); loadRules()
  }, [boot.ready, loadReceipts, loadRules, err])

  useEffect(() => { if (timeLeft == null) return; const t = setInterval(() => setTimeLeft(s => (s == null ? s : Math.max(0, s - 1))), 1000); return () => clearInterval(t) }, [timeLeft == null])

  // pending approvals
  useEffect(() => {
    if (!boot.ready) return
    let stop = false, timer: any
    const tick = () => api('GET', '/api/pending').then(l => { if (!stop) setPending(Array.isArray(l) ? l : []) }).catch(() => {}).finally(() => { if (!stop) timer = setTimeout(tick, running ? 1500 : 4000) })
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [boot.ready, running])

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }) }, [rows, ocLog])

  const finish = useCallback((t: Task, outcome: string) => {
    setRunning(null); loadReceipts()
    toast(`${t.title}: ${outcome}`, outcome === 'finished' ? 'ok' : outcome === 'held' ? 'info' : 'err')
  }, [loadReceipts, toast])

  const pollDemo = useCallback((t: Task, myRun: number, start: number, saw = false) => {
    api('GET', '/api/demo').then(d => {
      if (runRef.current !== myRun) return
      const isRun = d?.status === 'running'
      const stale = !isRun && !saw && Date.now() - start < 5000
      if (!stale) setRows(buildRows(d?.events || []))
      if (!isRun && !stale) {
        const r = buildRows(d?.events || [])
        const o = d?.error ? 'error' : r.some(x => x.dec === 'blocked' || x.dec === 'denied') ? 'blocked' : r.some(x => x.dec === 'held') ? 'held' : 'finished'
        finish(t, o); return
      }
      setTimeout(() => pollDemo(t, myRun, start, saw || isRun), 1500)
    }).catch(() => { if (runRef.current === myRun) setTimeout(() => pollDemo(t, myRun, start, saw), 2500) })
  }, [finish])

  const pollOC = useCallback((t: Task, myRun: number, start: number, saw = false) => {
    api('GET', '/api/opencode').then(o => {
      if (runRef.current !== myRun) return
      setOcLog(String(o?.log || ''))
      if (!o?.running && (saw || Date.now() - start > 90000)) { finish(t, 'finished'); return }
      setTimeout(() => pollOC(t, myRun, start, saw || !!o?.running), 1500)
    }).catch(() => { if (runRef.current === myRun) setTimeout(() => pollOC(t, myRun, start, saw), 2500) })
  }, [finish])

  const start = useCallback((t: Task) => {
    if (running || !boot.ready) return
    const myRun = ++runRef.current, startAt = Date.now()
    setRunning(t); setRows([]); setOcLog('')
    const p = t.ep === 'A' ? api('POST', '/api/agent/task', { task: t.task })
      : t.ep === 'C' ? api('POST', '/api/attacks/' + encodeURIComponent(t.attack!))
      : api('POST', '/api/arena/attempt', { level: 1, text: t.task, agent: 'opencode' })
    p.then(() => (t.ep === 'B' ? pollOC(t, myRun, startAt) : pollDemo(t, myRun, startAt)))
      .catch(e => { err('Could not start task', e); setRunning(null) })
  }, [running, boot.ready, pollDemo, pollOC, err])

  const decide = (id: string, path: string, label: string) =>
    api('POST', path).then(() => { toast(label, 'ok'); setPending(p => p.filter(x => x.id !== id)) }).catch(e => err('Could not ' + label.toLowerCase(), e))

  const counts = useMemo(() => {
    const c = { allowed: 0, held: 0, blocked: 0 }
    rows.forEach(r => { if (r.dec === 'allowed' || r.dec === 'approved') c.allowed++; else if (r.dec === 'held') c.held++; else if (r.dec) c.blocked++ })
    return c
  }, [rows])

  const policyLocked = !!running || busy || !boot.ready
  const pol = (fn: () => Promise<any>) => { setBusy(true); return fn().finally(() => setBusy(false)) }
  const pk: string = info?.public_key || ''
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="min-h-screen bg-canvas text-zinc-200">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-semibold tracking-tight text-white">OVARA <span className="text-accent">Shift</span></span>
            <span className="hidden text-xs text-zinc-500 sm:inline">A coding agent on shift. OVARA on the wire.</span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs">
            {boot.ready && timeLeft != null && <span className="flex items-center gap-1 font-mono text-zinc-400"><Clock className="size-3.5" />{fmtTime(timeLeft)}</span>}
            <Badge tone={boot.ready ? 'green' : boot.code && boot.code !== 'booting' ? 'red' : 'amber'} dot>
              {boot.ready ? 'Live' : boot.code === 'full' ? 'At capacity' : boot.code === 'daily' ? 'Daily limit' : 'Booting sandbox'}
            </Badge>
          </div>
        </div>
        <AnimatePresence>{!boot.ready && boot.message && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden border-t border-line bg-amber-500/5 text-center text-xs text-amber-200">
            <div className="px-4 py-2">{boot.message}</div>
          </motion.div>)}</AnimatePresence>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        {/* status strip */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[['Allowed', counts.allowed, 'text-emerald-300'], ['Held', counts.held, 'text-amber-300'], ['Blocked', counts.blocked, 'text-red-300']].map(([l, v, c]) => (
            <div key={l as string} className="rounded-xl bg-panel px-4 py-3 ring-1 ring-line">
              <div className="text-[11px] uppercase tracking-wider text-zinc-500">{l}</div>
              <div className={`mt-1 font-mono text-2xl ${c}`}>{v}</div>
            </div>))}
          <div className="rounded-xl bg-panel px-4 py-3 ring-1 ring-line">
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">Signed receipts</div>
            <div className="mt-1 flex items-center gap-2"><span className="font-mono text-2xl text-zinc-100">{receipts.length}</span>
              {integrity != null && <Badge tone={integrity ? 'green' : 'red'}><ShieldCheck className="size-3" />{integrity ? 'Chain verified' : 'Chain broken'}</Badge>}</div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            {/* queue */}
            <Card title="Queue" right={running && <Badge tone="indigo" dot>Running</Badge>}>
              <Textarea rows={3} value={composer} onChange={e => setComposer(e.target.value)} placeholder="Give the agent a task…" disabled={!!running} />
              <div className="mt-2 flex gap-2">
                <Button variant="primary" size="sm" className="flex-1" disabled={!composer.trim() || !!running || !boot.ready}
                  onClick={() => start({ id: 'custom', title: composer.trim(), ep: 'A', task: composer.trim() })}><Play className="size-3.5" />Run with Nemotron</Button>
                <Button size="sm" className="flex-1" disabled={!composer.trim() || !!running || !boot.ready}
                  onClick={() => start({ id: 'custom-oc', title: composer.trim(), ep: 'B', task: composer.trim() })}><Terminal className="size-3.5" />Run with OpenCode</Button>
              </div>
              <ul className="mt-3 divide-y divide-line">
                {TASKS.map(t => (
                  <li key={t.id} className="flex items-center gap-2 py-2">
                    <span className="flex-1 truncate text-sm text-zinc-300">{t.title}</span>
                    {t.ep === 'B' && <Badge tone="indigo">OpenCode</Badge>}
                    {t.ep === 'C' && <Badge tone="red">Drill</Badge>}
                    <Button size="sm" variant={running?.id === t.id ? 'primary' : 'ghost'} disabled={!!running || !boot.ready} onClick={() => start(t)}>
                      {running?.id === t.id ? 'Running' : 'Run'}</Button>
                  </li>))}
              </ul>
            </Card>

            {/* approvals */}
            <Card title={`Approvals${pending.length ? ` · ${pending.length}` : ''}`}>
              {!pending.length && <p className="text-sm text-zinc-500">Nothing waiting on you.</p>}
              <div className="space-y-3">
                <AnimatePresence>{pending.map(p => (
                  <motion.div key={p.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                    className="rounded-lg bg-amber-500/5 p-3 ring-1 ring-amber-500/25">
                    <div className="text-sm font-medium text-amber-100">{p.what}</div>
                    {p.raw && <div className="mt-1 truncate font-mono text-xs text-zinc-400" title={p.raw}>{p.raw}</div>}
                    {p.judge && <div className="mt-2 text-xs text-zinc-300">{p.judge.summary}{p.judge.reason && <span className="text-zinc-500"> · {p.judge.reason}</span>}</div>}
                    {Array.isArray(p.details) && p.details.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-zinc-500">{p.details.map((d: any, i: number) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}</ul>}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="success" onClick={() => decide(p.id, `/api/approve/${encodeURIComponent(p.id)}`, 'Approved')}>Approve</Button>
                      <Button size="sm" onClick={() => decide(p.id, `/api/approve/${encodeURIComponent(p.id)}?remember=${encodeURIComponent(p.remember?.[0]?.key || 'host')}`, 'Approved and remembered')}>Approve and remember</Button>
                      <Button size="sm" variant="danger" onClick={() => decide(p.id, `/api/deny/${encodeURIComponent(p.id)}`, 'Denied')}>Deny</Button>
                    </div>
                  </motion.div>))}</AnimatePresence>
              </div>
            </Card>
          </div>

          {/* live feed */}
          <Card title={running ? `Live · ${running.title}` : 'Live feed'} className="flex min-h-[420px] flex-col">
            <div ref={feedRef} className="max-h-[560px] min-h-[360px] space-y-0.5 overflow-y-auto">
              {!rows.length && !ocLog && <p className="text-sm text-zinc-500">{boot.ready ? 'Pick a task. Every request the agent makes shows up here with OVARA’s decision.' : 'Waiting for the sandbox…'}</p>}
              {rows.map(r => r.type === 'thought' ? (
                <div key={r.key} className="py-1 pl-[72px] text-xs italic text-zinc-500">{r.text}</div>
              ) : r.type === 'exit' ? (
                <div key={r.key} className="py-0.5 pl-[72px] font-mono text-[11px] text-zinc-600">{r.text}</div>
              ) : (
                <motion.div key={r.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="rounded-md px-1 py-1 hover:bg-white/[0.03]">
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-600">{hhmm(r.at)}</span>
                    <Badge tone={r.type === 'req' ? 'neutral' : 'indigo'} className="w-14 justify-center">{r.kind}</Badge>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title={r.text}>{r.text}</span>
                    {r.dec && <Badge tone={decTone(r.dec)}>{r.dec}</Badge>}
                  </div>
                  {r.rule && !hideRule(r.rule) && <div className="truncate pl-[136px] text-[11px] text-zinc-500">{r.rule}</div>}
                </motion.div>))}
              {ocLog && <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-300">{ocLog}</pre>}
            </div>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* receipts */}
          <Card title="Receipts" right={<Button size="sm" variant="ghost" onClick={() => loadReceipts().then(() => toast('Receipts re-verified', 'ok'))}><ShieldCheck className="size-3.5" />Verify</Button>}>
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-500"><KeyRound className="size-3.5" />Public key <span className="font-mono text-zinc-300" title={pk}>{pk ? (pk.length > 22 ? pk.slice(0, 12) + '…' + pk.slice(-8) : pk) : '-'}</span></div>
            {!receipts.length && <p className="text-sm text-zinc-500">No receipts yet.</p>}
            <ul className="divide-y divide-line">
              {receipts.slice(-8).reverse().map((r, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5">
                  <span className="w-16 shrink-0 font-mono text-[11px] text-zinc-600">{r.timestamp ? hhmm(new Date(r.timestamp).getTime()) : ''}</span>
                  <Badge tone={decTone(DECISIONS[String(r.outcome || '').toLowerCase()] || null)}>{r.outcome}</Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-300" title={r.what}>{r.what}</span>
                  <span className="hidden max-w-[35%] truncate text-[11px] text-zinc-500 md:block" title={r.rule}>{r.rule}</span>
                </li>))}
            </ul>
          </Card>

          {/* policy */}
          <Card title="Policy" right={rules?.custom && <Badge tone="indigo">Custom</Badge>}>
            <SegmentedControl className="w-full" disabled={policyLocked}
              options={[{ value: 'strict', label: 'Strict' }, { value: 'balanced', label: 'Balanced' }, { value: 'permissive', label: 'Permissive' }]}
              value={rules?.preset ?? null}
              onChange={v => pol(() => api('POST', '/api/rules/preset', { preset: v }).then(() => { toast('Policy set to ' + v + '. Rerun a task to see it.', 'ok'); return loadRules() }).catch(e => err('Could not set policy', e)))} />
            {rules?.protections && <div className="mt-3 flex flex-wrap gap-1.5">
              {Object.entries(rules.protections).map(([k, v]) => <Badge key={k} tone={v ? 'green' : 'neutral'}>{k.replace('_', ' ')} {v ? 'on' : 'off'}</Badge>)}
            </div>}
            <Textarea className="mt-3" rows={2} disabled={policyLocked} value={policyReq} onChange={e => setPolicyReq(e.target.value)} placeholder="Describe a rule in plain English, e.g. never let the agent push to main" />
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" disabled={policyLocked || !policyReq.trim()}
                onClick={() => pol(() => api('POST', '/api/rules/draft', { request: policyReq.trim() }).then(setDraft).catch(e => err('Could not draft', e)))}>{busy ? 'Drafting…' : 'Draft with Nemotron'}</Button>
              {draft && draft.valid !== false && <Button size="sm" variant="success" disabled={policyLocked}
                onClick={() => pol(() => api('POST', '/api/rules/draft/apply', {}).then(() => { toast('Policy applied. Rerun a task to see it.', 'ok'); setDraft(null); setPolicyReq(''); return loadRules() }).catch(e => err('Could not apply', e)))}>Apply</Button>}
              <Button size="sm" variant="ghost" className="ml-auto" disabled={policyLocked}
                onClick={() => pol(() => api('POST', '/api/rules/reset', {}).then(() => { toast('Policy reset to default', 'ok'); setDraft(null); return loadRules() }).catch(e => err('Could not reset', e)))}>Reset</Button>
            </div>
            {running && <p className="mt-2 text-[11px] text-zinc-500">Policy is locked while a task runs.</p>}
            <AnimatePresence>{draft && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-lg bg-black/30 p-3 text-xs ring-1 ring-line">
                {draft.explanation && <p className="text-zinc-300">{draft.explanation}</p>}
                {(draft.added || []).map((a: any, i: number) => <div key={'a' + i} className="mt-1 font-mono text-emerald-300">+ {typeof a === 'string' ? a : JSON.stringify(a)}</div>)}
                {(draft.removed || []).map((a: any, i: number) => <div key={'r' + i} className="mt-1 font-mono text-red-300">- {typeof a === 'string' ? a : JSON.stringify(a)}</div>)}
                {draft.valid === false && <div className="mt-2 text-red-300">{(draft.errors || []).join('; ') || 'Draft is not valid.'}</div>}
              </motion.div>)}</AnimatePresence>
          </Card>
        </div>
      </main>
    </div>
  )
}

export default function App() { return <ToastProvider><Shift /></ToastProvider> }
