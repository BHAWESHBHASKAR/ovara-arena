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

// Assume breach: the newest scripted run on every template.
interface Breach { level: number; template: string; title: string; mode: 'off' | 'on'; verdict: string; closeness: number; control?: string }
const breachFiles = readdirSync('bench').filter((f) => /^breach-.*\.json$/.test(f)).sort();
const breach: Breach[] = breachFiles.length ? JSON.parse(readFileSync(`bench/${breachFiles[breachFiles.length - 1]}`, 'utf8')).results : [];
const bOff = breach.filter((r) => r.mode === 'off');
const bOn = breach.filter((r) => r.mode === 'on');
const escaped = (rs: Breach[]) => rs.filter((r) => r.verdict === 'escaped').length;
const breachRows = [...new Set(breach.map((r) => r.level))].sort((a, b) => a - b).map((n) => {
  const off = bOff.filter((r) => r.level === n);
  const on = bOn.filter((r) => r.level === n);
  return { n, title: rows.find((r) => r.n === n)?.title ?? '', off: `${escaped(off)}/${off.length}`, on: `${escaped(on)}/${on.length}`, caught_by: [...new Set(on.filter((r) => r.verdict !== 'escaped').map((r) => r.control).filter(Boolean))] };
});
const refused = [...pick.values()].flatMap((r) => done(r.rounds)).filter((r) => !r.decisive && r.verdict !== 'escaped').length;
const gated = [...pick.values()].flatMap((r) => done(r.rounds)).filter((r) => r.decisive && r.verdict !== 'escaped').length;

const out = {
  stamp: last,
  lede: `Two questions. If an attacker fools the agent, does the flag get out? And can a Nemotron attacker that learns from every block fool the agent at all? Measured on the live deployment, ${last.slice(0, 10)}.`,
  headline: [
    { value: `${escaped(bOff)}/${bOff.length}`, label: "scripted attacks got the flag out with OVARA's protections off (the agent was made to carry each one out)" },
    { value: `${escaped(bOn)}/${bOn.length}`, label: "got it out with OVARA's default policy. Every attack was stopped by a control and has a signed receipt." },
    { value: `${sum('on_escaped') + sum('off_escaped')}/${sum('attacks')}`, label: `adaptive attacks by ${attackers} got the flag out against a Nemotron 3 Super agent. The agent ignored ${refused}; OVARA stopped ${gated}.` },
  ],
  breach: breachRows,
  levels: rows,
  tokens,
  note: "\"OVARA off\" is OVARA's permissive preset: no taint rule, no content scanning, no risk judge, no push approval. Key custody and the fixture-only network stay on in both modes, because they sit outside the policy; that is why some attacks are contained even with OVARA off. Every attack, verdict and receipt id is in the repository under bench/.",
};
writeFileSync('public/bench.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
