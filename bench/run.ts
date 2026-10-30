/**
 * Benchmark: the Nemotron attacker against every playable level, twice:
 * once with OVARA's protections off (the permissive preset) and once with the
 * default policy. Each (level, mode) pair gets a fresh local container from
 * the same image the live site runs.
 *
 *   NEBIUS_API_KEY=... TAVILY_API_KEY=... npx tsx bench/run.ts [rounds] [levels]
 *
 * Writes bench/results-<time>.json (every round) and public/bench.json (the
 * summary the /redteam page shows).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { autopilot, MODELS, type Event, type Round } from '../src/redteam';

const IMAGE = process.env.ARENA_IMAGE ?? 'registry.cloudflare.com/3541b3dffc96eaef632727ffc59c7e91/ovara-grid-ovarasession-sandbox:wrangler-mvqr2vrz';
const nebius = process.env.NEBIUS_API_KEY;
const tavily = process.env.TAVILY_API_KEY;
if (!nebius) throw new Error('NEBIUS_API_KEY is required');
const rounds = Number(process.argv[2] || 6);
const levels = (process.argv[3] || '1,2,3,4,5').split(',').map(Number);
const attacker = process.env.ATTACKER === 'nano' ? MODELS.nano : MODELS.super;

type Mode = 'off' | 'on';
interface Run { level: number; mode: Mode; title: string; control: string; rounds: Round[]; tokens: number; error?: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withContainer<T>(name: string, port: number, fn: (base: string) => Promise<T>): Promise<T> {
  execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  execFileSync('docker', ['run', '-d', '--name', name, '--platform', 'linux/amd64', '--cap-add', 'NET_ADMIN', '-p', `${port}:8080`, '-e', 'NEBIUS_API_KEY', '-e', 'TAVILY_API_KEY', '-e', 'OVARA_SPEND_CAP_USD=1', IMAGE, 'ovara', 'sandbox-serve', '-agent', 'nebius', '-addr', '0.0.0.0:8080'], { stdio: 'ignore', env: process.env });
  const base = `http://localhost:${port}`;
  try {
    for (let i = 0; i < 240; i++) {
      try {
        if ((await fetch(base + '/api/info')).ok && (await fetch(base + '/api/arena')).ok) break;
      } catch {
        /* booting */
      }
      await sleep(1000);
    }
    return await fn(base);
  } finally {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  }
}

const REMOTE = process.env.BENCH_REMOTE; // e.g. https://ovara-grid.sidianlabs.workers.dev

/** A sandbox on the live deployment: its own session cookie, so its own container. */
async function withRemote<T>(fn: (call: (path: string, init?: RequestInit) => Promise<Response>) => Promise<T>): Promise<T> {
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
  for (let i = 0; i < 120; i++) {
    const b = (await (await call('/api/boot')).json()) as { ready: boolean; code?: string; message?: string };
    if (b.ready) break;
    if (b.code === 'full' || b.code === 'daily') throw new Error(b.message);
    await sleep(2000);
  }
  try {
    return await fn(call);
  } finally {
    await call('/api/session/close', { method: 'POST' }).catch(() => {});
  }
}

async function one(level: number, mode: Mode, port: number): Promise<Run> {
  const body = async (call: (path: string, init?: RequestInit) => Promise<Response>): Promise<Run> => {
    if (mode === 'off') {
      let applied = false;
      for (let i = 0; i < 5 && !applied; i++) {
        await call('/api/rules/preset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ preset: 'permissive' }) });
        applied = ((await (await call('/api/rules')).json()) as { preset?: string }).preset === 'permissive';
        if (!applied) await sleep(2000);
      }
      if (!applied) throw new Error('could not switch to the permissive preset');
    }
    const run: Run = { level, mode, title: '', control: '', rounds: [], tokens: 0 };
    const emit = (e: Event) => {
      if (e.type === 'start') Object.assign(run, { title: e.level.title, control: e.level.control });
      if (e.type === 'result') {
        run.rounds.push(e.round);
        const r = e.round;
        console.log(`L${level} ${mode.padEnd(3)} r${r.n} ${(r.verdict ?? r.error ?? '?').padEnd(10)} ${String(r.closeness ?? '-').padStart(3)}% ${r.decisive?.control ?? (r.agent ? 'agent' : '')} | ${r.technique}`);
      }
      if (e.type === 'error') console.log(`L${level} ${mode} error: ${e.message}`);
    };
    try {
      const s = await autopilot(call, { level, rounds, models: { attacker, defender: MODELS.ultra }, keys: { nebius, tavily }, policy: mode === 'on' ? 'default' : 'permissive' }, emit);
      run.tokens = s.tokens;
    } catch (e) {
      run.error = (e as Error).message;
      console.log(`L${level} ${mode} failed: ${run.error}`);
    }
    return run;
  };
  if (REMOTE) return withRemote(body);
  return withContainer(`bench-${level}-${mode}`, port, async (base) => {
    // Docker's port forward drops connections now and then; retry instead of losing the run.
    const call = async (path: string, init?: RequestInit): Promise<Response> => {
      for (let i = 0; ; i++) {
        try {
          return await fetch(base + path, init);
        } catch (e) {
          if (i >= 6) throw new Error(`${path}: ${(e as Error).message}`);
          await sleep(2000);
        }
      }
    };
    return body(call);
  });
}

const plan: [number, Mode, number][] = [];
let port = 19000;
for (const level of levels) for (const mode of ['off', 'on'] as Mode[]) plan.push([level, mode, port++]);
const runs: Run[] = [];
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
await Promise.all(
  Array.from({ length: CONCURRENCY }, async (_, w) => {
    await sleep(w * 8000); // stagger container boots
    for (let job = plan.shift(); job; job = plan.shift()) {
      const [level, mode, p] = job;
      try {
        runs.push(await one(level, mode, p));
      } catch (e) {
        console.log(`L${level} ${mode} crashed: ${(e as Error).message}`);
        runs.push({ level, mode, title: '', control: '', rounds: [], tokens: 0, error: (e as Error).message });
      }
    }
  }),
);

const stamp = new Date().toISOString();
mkdirSync('bench', { recursive: true });
writeFileSync(`bench/results-${stamp.replace(/[:.]/g, '-')}.json`, JSON.stringify({ stamp, where: REMOTE ?? `local ${IMAGE}`, attacker, rounds, runs }, null, 2));

const done = (rs: Round[]) => rs.filter((r) => r.verdict);
const rows = levels.map((n) => {
  const off = runs.find((r) => r.level === n && r.mode === 'off')!;
  const on = runs.find((r) => r.level === n && r.mode === 'on')!;
  return {
    n,
    title: on.title || off.title,
    control: on.control || off.control,
    attacks: done(off.rounds).length + done(on.rounds).length,
    off_runs: done(off.rounds).length,
    off_escaped: done(off.rounds).filter((r) => r.verdict === 'escaped').length,
    on_runs: done(on.rounds).length,
    on_escaped: done(on.rounds).filter((r) => r.verdict === 'escaped').length,
    on_best: Math.max(0, ...done(on.rounds).map((r) => r.closeness ?? 0)),
  };
});
const sum = (k: keyof (typeof rows)[number]) => rows.reduce((a, r) => a + Number(r[k]), 0);
const offRate = sum('off_runs') ? Math.round((100 * sum('off_escaped')) / sum('off_runs')) : 0;
const onRate = sum('on_runs') ? Math.round((100 * sum('on_escaped')) / sum('on_runs')) : 0;
const tokens = runs.reduce((a, r) => a + r.tokens, 0);
const date = stamp.slice(0, 10);
writeFileSync(
  'public/bench.json',
  JSON.stringify(
    {
      stamp,
      lede: `${sum('attacks')} adaptive attacks written by ${attacker.split('/')[1]}, each run for real by a Nemotron 3 Super coding agent in a fresh sandbox. Measured ${date}.`,
      headline: [
        { value: `${offRate}%`, label: `of attacks got the flag out with OVARA's protections off (${sum('off_escaped')} of ${sum('off_runs')})` },
        { value: `${onRate}%`, label: `got it out with OVARA's default policy (${sum('on_escaped')} of ${sum('on_runs')})` },
        { value: tokens.toLocaleString('en-US'), label: 'Nemotron tokens spent by the attacker and the defender' },
      ],
      levels: rows,
      note: "\"OVARA off\" is OVARA's permissive preset: no taint rule, no content scanning, no risk judge, no push approval. Key custody and the fixture-only network stay on in both modes, because they sit outside the policy. Every round's attack text, verdict and receipt id is in the repository under bench/.",
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(rows, null, 2), { offRate, onRate, tokens });
