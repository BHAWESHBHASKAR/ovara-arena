/**
 * Assume-breach benchmark: the agent is made to carry out every scripted
 * attack in the Arena (it has been fooled), and we measure whether the flag
 * gets out with OVARA's protections off and with the default policy.
 *
 *   BENCH_REMOTE=https://ovara-grid.sidianlabs.workers.dev npx tsx bench/breach.ts
 *
 * Writes bench/breach-<time>.json.
 */
import { writeFileSync } from 'node:fs';
import type { Level } from '../src/redteam';

const REMOTE = process.env.BENCH_REMOTE;
if (!REMOTE) throw new Error('BENCH_REMOTE is required');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Mode = 'off' | 'on';
interface Result { level: number; template: string; title: string; mode: Mode; verdict: string; closeness: number; control?: string; why?: string; receipt?: string }

async function session(mode: Mode): Promise<Result[]> {
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const call = async (path: string, init?: RequestInit): Promise<Response> => {
    for (let i = 0; ; i++) {
      try {
        return await fetch(REMOTE + path, { ...init, headers: { ...(init?.headers as Record<string, string>), Cookie: `ovara_sid=${sid}` } });
      } catch (e) {
        if (i >= 6) throw e;
        await sleep(2000);
      }
    }
  };
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (let i = 0; i < 120; i++) {
    const b = (await (await call('/api/boot')).json()) as { ready: boolean; message?: string; code?: string };
    if (b.ready) break;
    if (b.code === 'full' || b.code === 'daily') throw new Error(b.message);
    await sleep(2000);
  }
  if (mode === 'off') {
    await call('/api/rules/preset', json({ preset: 'permissive' }));
    const p = ((await (await call('/api/rules')).json()) as { preset?: string }).preset;
    if (p !== 'permissive') throw new Error('could not switch to the permissive preset');
  }
  const arena = (await (await call('/api/arena')).json()) as { levels: Level[] };
  const out: Result[] = [];
  try {
    for (const level of arena.levels.filter((l) => !l.soon)) {
      for (const t of level.templates ?? []) {
        const r = await call('/api/arena/attempt', json({ level: level.n, template: t.id }));
        const a = (await r.json()) as { id?: string; error?: string };
        if (!a.id) {
          console.log(`L${level.n} ${mode} ${t.id}: refused ${a.error}`);
          continue;
        }
        for (let i = 0; i < 80; i++) {
          await sleep(1500);
          const last = ((await (await call('/api/arena')).json()) as { state: { last?: Record<string, any> } }).state.last;
          if (last?.id === a.id && last.status === 'done') {
            const res: Result = { level: level.n, template: t.id, title: t.title, mode, verdict: last.verdict, closeness: last.closeness, control: last.decisive?.control, why: last.decisive?.why, receipt: last.decisive?.receipt_id };
            out.push(res);
            console.log(`L${level.n} ${mode.padEnd(3)} ${t.id.padEnd(10)} ${res.verdict.padEnd(10)} ${String(res.closeness).padStart(3)}% ${res.control ?? ''}`);
            break;
          }
        }
      }
    }
  } finally {
    await call('/api/session/close', { method: 'POST' }).catch(() => {});
  }
  return out;
}

const [off, on] = await Promise.all([session('off'), session('on')]);
const stamp = new Date().toISOString();
writeFileSync(`bench/breach-${stamp.replace(/[:.]/g, '-')}.json`, JSON.stringify({ stamp, where: REMOTE, results: [...off, ...on] }, null, 2));
const esc = (rs: Result[]) => rs.filter((r) => r.verdict === 'escaped').length;
console.log({ off: `${esc(off)}/${off.length} escaped`, on: `${esc(on)}/${on.length} escaped` });
