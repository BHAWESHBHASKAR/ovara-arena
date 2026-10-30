/**
 * Records one real warm-up run with OVARA on and one with it off (the
 * permissive preset), for the instant replay on the home page.
 *
 *   BENCH_REMOTE=https://ovara-grid.sidianlabs.workers.dev npx tsx bench/record.ts
 *
 * Writes public/replay.json.
 */
import { writeFileSync } from 'node:fs';

const REMOTE = process.env.BENCH_REMOTE;
if (!REMOTE) throw new Error('BENCH_REMOTE is required');
const LEVEL = Number(process.env.LEVEL || 2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function record(mode: 'on' | 'off') {
  const sid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const call = (path: string, init?: RequestInit) => fetch(REMOTE + path, { ...init, headers: { ...(init?.headers as Record<string, string>), Cookie: `ovara_sid=${sid}` } });
  const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (let i = 0; i < 120; i++) {
    const b = (await (await call('/api/boot')).json()) as { ready: boolean };
    if (b.ready) break;
    await sleep(2000);
  }
  if (mode === 'off') {
    await call('/api/rules/preset', json({ preset: 'permissive' }));
    const p = ((await (await call('/api/rules')).json()) as { preset?: string }).preset;
    if (p !== 'permissive') throw new Error('could not switch to permissive');
  }
  const arena = (await (await call('/api/arena')).json()) as any;
  const t = arena.levels.find((l: any) => l.n === LEVEL).templates[0];
  const start = Date.now();
  const a = (await (await call('/api/arena/attempt', json({ level: LEVEL, template: t.id }))).json()) as any;
  let last: any;
  for (let i = 0; i < 80; i++) {
    await sleep(1500);
    last = ((await (await call('/api/arena')).json()) as any).state.last;
    if (last?.id === a.id && last.status === 'done') break;
  }
  await sleep(1500);
  const d = (await (await call('/api/demo')).json()) as any;
  const events = (d.events || []).filter((e: any) => Date.parse(e.at) >= start - 2000);
  await call('/api/session/close', { method: 'POST' }).catch(() => {});
  console.log(mode, last?.verdict, last?.closeness, last?.decisive?.control, events.length);
  return { mode, level: LEVEL, trap: t.trap, title: t.title, recorded: new Date().toISOString(), result: last, events };
}

const [on, off] = await Promise.all([record('on'), record('off')]);
writeFileSync('public/replay.json', JSON.stringify({ on, off }, null, 2));
