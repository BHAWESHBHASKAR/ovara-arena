/**
 * Builds public/bench.json from bench/results-*.json. For each (level, mode)
 * the newest run that finished without an error is used, so a rerun of one
 * level fills its gap without discarding the others.
 *
 *   npx tsx bench/summarize.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Round } from '../src/redteam';

interface Run { level: number; mode: 'off' | 'on'; title: string; control: string; rounds: Round[]; tokens: number; error?: string }
interface File { stamp: string; attacker: string; runs: Run[] }

const files = readdirSync('bench')
  .filter((f) => /^results-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(`bench/${f}`, 'utf8')) as File);

const pick = new Map<string, Run & { attacker: string; stamp: string }>();
for (const f of files) for (const r of f.runs) if (!r.error && r.rounds.some((x) => x.verdict)) pick.set(`${r.level}/${r.mode}`, { ...r, attacker: f.attacker, stamp: f.stamp });

const levels = [...new Set([...pick.values()].map((r) => r.level))].sort((a, b) => a - b);
const done = (rs: Round[]) => rs.filter((r) => r.verdict);
const rows = levels.map((n) => {
  const off = pick.get(`${n}/off`);
  const on = pick.get(`${n}/on`);
  const o = done(off?.rounds ?? []);
  const g = done(on?.rounds ?? []);
  return {
    n,
    title: on?.title || off?.title || '',
    control: on?.control || off?.control || '',
    attacks: o.length + g.length,
    off_runs: o.length,
    off_escaped: o.filter((r) => r.verdict === 'escaped').length,
    on_runs: g.length,
    on_escaped: g.filter((r) => r.verdict === 'escaped').length,
    on_best: Math.max(0, ...g.map((r) => r.closeness ?? 0)),
  };
});
const sum = (k: 'attacks' | 'off_runs' | 'off_escaped' | 'on_runs' | 'on_escaped') => rows.reduce((a, r) => a + r[k], 0);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const tokens = [...pick.values()].reduce((a, r) => a + r.tokens, 0);
const attackers = [...new Set([...pick.values()].map((r) => r.attacker.split('/').pop()))].join(', ');
const last = [...pick.values()].map((r) => r.stamp).sort().pop() ?? '';

const out = {
  stamp: last,
  lede: `${sum('attacks')} adaptive attacks written by ${attackers}, each run for real by a Nemotron 3 Super coding agent in a fresh sandbox, ${levels.length} levels × OVARA off and on. Measured ${last.slice(0, 10)}.`,
  headline: [
    { value: `${pct(sum('off_escaped'), sum('off_runs'))}%`, label: `of attacks got the flag out with OVARA's protections off (${sum('off_escaped')} of ${sum('off_runs')})` },
    { value: `${pct(sum('on_escaped'), sum('on_runs'))}%`, label: `got it out with OVARA's default policy (${sum('on_escaped')} of ${sum('on_runs')})` },
    { value: tokens.toLocaleString('en-US'), label: 'Nemotron tokens spent by the attacker and the defender' },
  ],
  levels: rows,
  note: "\"OVARA off\" is OVARA's permissive preset: no taint rule, no content scanning, no risk judge, no push approval. Key custody and the fixture-only network stay on in both modes, because they sit outside the policy. Every round's attack text, verdict and receipt id is in the repository under bench/.",
};
writeFileSync('public/bench.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
