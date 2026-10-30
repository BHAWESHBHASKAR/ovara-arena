import { DurableObject } from 'cloudflare:workers';
import { autopilot, MODELS, type Event } from './redteam';

interface Env {
  SESSION: DurableObjectNamespace<OvaraSession>;
  QUOTA: DurableObjectNamespace<Quota>;
  ASSETS: Fetcher;
  NEBIUS_API_KEY?: string;
  NVIDIA_API_KEY?: string;
  TAVILY_API_KEY?: string;
  LLM_PROVIDER?: string;
  SESSIONS_PER_DAY?: string;
  /** Sandboxes that may run at once (a Durable Object-managed container has no max_instances). */
  MAX_CONCURRENT?: string;
  /** Kill switch: "1" refuses new sessions and stops running ones. */
  DEMO_DISABLED?: string;
  /** Secret for /_admin/*: the slot table, a request log and a reset. */
  ADMIN_TOKEN?: string;
  /** Per-sandbox spend cap in USD for providers with a spend guard. */
  SPEND_CAP_USD?: string;
  /** Free-text attacks (a real model reads each one) allowed per day across all visitors. */
  FREE_ATTACKS_PER_DAY?: string;
  /** Red-team autopilot runs allowed per day across all visitors. */
  REDTEAM_RUNS_PER_DAY?: string;
}

const IDLE_MS = 12 * 60 * 1000; // an idle sandbox is stopped
const MAX_LIFETIME_MS = 30 * 60 * 1000; // and no sandbox lives longer than this
const CLOSE_GRACE_MS = 25 * 1000; // after the tab closes; a reload comes back within this
// A slot lasts as long as the idle window and is renewed by use, so an
// abandoned session frees its slot within minutes.
const LEASE_MS = IDLE_MS + 60_000;
const SID = /^[a-f0-9]{24}$/;
// Bump when Quota's code changes: a running Durable Object keeps its old code.
const QUOTA_NAME = 'sessions-v7';

function cookie(req: Request, name: string): string | undefined {
  return req.headers.get('Cookie')?.split(/;\s*/).map((c) => c.split('=')).find(([k]) => k === name)?.[1];
}
const newSid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const text = (s: string, status: number, code = 'error') =>
  new Response(JSON.stringify({ error: s, code }), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/_admin/')) return admin(req, env, u);
    if (u.pathname === '/redteam') return Response.redirect(`${u.origin}/demo`, 302);
    if (u.pathname === '/shift' || u.pathname === '/shift.html') return Response.redirect(`${u.origin}/`, 302);
    if (u.pathname === '/stats') {
      // Public numbers for the landing page. Never touches a sandbox.
      const t = (await env.QUOTA.getByName(QUOTA_NAME).publicStats(Number(env.MAX_CONCURRENT || 6), Number(env.SESSIONS_PER_DAY || 60))) as Record<string, unknown>;
      return Response.json({ ...t, paused: env.DEMO_DISABLED === '1' }, { headers: { 'Cache-Control': 'public, max-age=5' } });
    }

    // 1. The page itself never touches a sandbox. It only hands out a session id.
    if (!u.pathname.startsWith('/api/')) {
      // The Shift console is the home page; the full OVARA dashboard stays at /app.
      const assetReq = u.pathname === '/' ? new Request(new URL('/next/index.html', u.origin), req) : u.pathname === '/classic' ? new Request(new URL('/shift.html', u.origin), req) : req;
      const res = await env.ASSETS.fetch(assetReq);
      const sid = cookie(req, 'ovara_sid');
      if (sid && SID.test(sid)) return res;
      const out = new Response(res.body, res);
      out.headers.append('Set-Cookie', `ovara_sid=${newSid()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`);
      out.headers.set('Cache-Control', 'no-store');
      return out;
    }

    // 2. The API needs a session cookie; without one nothing is allocated.
    const sid = cookie(req, 'ovara_sid');
    if (!sid || !SID.test(sid)) {
      ctx.waitUntil(env.QUOTA.getByName(QUOTA_NAME).note({ t: Date.now(), sid: '-', path: u.pathname, status: 401, ua: (req.headers.get('User-Agent') || '').slice(0, 40) }));
      return text('no session: load the page first', 401);
    }
    const session = env.SESSION.getByName(sid);
    if (env.DEMO_DISABLED === '1') {
      await session.stop();
      return text('The live demo is paused. See the repository README to run it yourself.', 503);
    }
    if (u.pathname === '/api/boot') {
      const b = await session.boot();
      return Response.json(b, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (u.pathname === '/api/redteam') return redteam(req, env, ctx, u, session);
    if (u.pathname === '/api/session/close') {
      await session.closeSoon();
      return new Response(null, { status: 204 });
    }

    const quota = env.QUOTA.getByName(QUOTA_NAME);
    // Free text is read by a real model: a global daily allowance keeps that bounded.
    if (u.pathname === '/api/arena/attempt' && req.method === 'POST') {
      const peek = await req.clone().json().catch(() => ({}) as Record<string, unknown>);
      if (typeof (peek as { text?: unknown }).text === 'string' && (peek as { text: string }).text.trim() !== '') {
        if (!(await quota.freeAllowed(Number(env.FREE_ATTACKS_PER_DAY || 300)))) {
          return text('Free-text attacks have reached today’s limit for everyone. The templates are still open.', 429, 'free_daily');
        }
      }
    }

    // 3. First API call of a session takes a slot (inside the session object).
    const res = await session.forward(req);
    if (u.pathname === '/api/arena/attempt' && req.method === 'POST' && res.status === 202) {
      ctx.waitUntil(res.clone().json().then((a) => quota.noteAttempt(String((a as { id?: string }).id), Number((a as { level?: number }).level))).catch(() => {}));
    }
    if (u.pathname === '/api/arena' && req.method === 'GET' && res.status === 200) {
      ctx.waitUntil(
        res
          .clone()
          .json()
          .then((j) => {
            const last = (j as { state?: { last?: { id: string; status: string; verdict: string; level: number; controls: string[]; policy?: string } } }).state?.last;
            if (last && last.status === 'done') // Only an escape past the default policy counts; a loosened or preset policy is the visitor's own choice.
            return quota.noteResult(last.id, last.verdict === 'escaped' && last.policy === 'default', last.level, last.controls ?? []);
          })
          .catch(() => {}),
      );
    }
    ctx.waitUntil(quota.note({ t: Date.now(), sid: sid.slice(0, 6), path: u.pathname, status: res.status, ua: (req.headers.get('User-Agent') || '').slice(0, 40) }));
    return res;
  },
} satisfies ExportedHandler<Env>;

/**
 * Server-sent events: a Nemotron attacker plays the visitor's own sandbox,
 * round by round, and Nemotron drafts the defending rule at the end.
 */
async function redteam(req: Request, env: Env, ctx: ExecutionContext, u: URL, session: DurableObjectStub<OvaraSession>): Promise<Response> {
  if (!env.NEBIUS_API_KEY) return text('The autopilot needs a Nemotron key on this deployment.', 503);
  const level = Number(u.searchParams.get('level') || 1);
  const rounds = Math.min(6, Math.max(1, Number(u.searchParams.get('rounds') || 5)));
  const attacker = u.searchParams.get('attacker') === 'nano' ? MODELS.nano : MODELS.super;
  const quota = env.QUOTA.getByName(QUOTA_NAME);
  if (!(await quota.redteamAllowed(Number(env.REDTEAM_RUNS_PER_DAY || 40)))) {
    return text('The autopilot has reached today’s limit for everyone. You can still attack by hand.', 429, 'redteam_daily');
  }
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const enc = new TextEncoder();
  const send = (e: Event) => w.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`)).catch(() => {});
  const origin = u.origin;
  const call = (path: string, init?: RequestInit) => session.forward(new Request(origin + path, { ...init, headers: { ...(init?.headers as Record<string, string>), Cookie: req.headers.get('Cookie') ?? '' } }));
  const keepAlive = setInterval(() => w.write(enc.encode(': ping\n\n')).catch(() => {}), 15_000);
  ctx.waitUntil(
    autopilot(call, { level, rounds, models: { attacker, defender: MODELS.ultra }, keys: { nebius: env.NEBIUS_API_KEY, tavily: env.TAVILY_API_KEY }, defend: true }, send)
      .then((s) => quota.noteRedteam(s.rounds, s.escaped))
      .catch((e) => send({ type: 'error', message: (e as Error).message }))
      .finally(() => {
        clearInterval(keepAlive);
        return w.close().catch(() => {});
      }),
  );
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

async function admin(req: Request, env: Env, u: URL): Promise<Response> {
  const want = env.ADMIN_TOKEN;
  if (!want || (req.headers.get('Authorization') ?? '') !== `Bearer ${want}`) return new Response('not found', { status: 404 });
  const quota = env.QUOTA.getByName(QUOTA_NAME);
  if (u.pathname === '/_admin/log') return Response.json(await quota.recent());
  if (u.pathname === '/_admin/slots') return Response.json(await quota.table());
  if (u.pathname === '/_admin/reset-stats' && req.method === 'POST') return Response.json(await quota.resetStats());
  if (u.pathname === '/_admin/reset' && req.method === 'POST') {
    const t = await quota.table();
    for (const l of t.leases) {
      try {
        await env.SESSION.get(env.SESSION.idFromString(l.session)).stop();
      } catch {
        /* a lease for a session that is gone */
      }
    }
    await quota.clear();
    return Response.json({ cleared: t.leases.length });
  }
  return new Response('not found', { status: 404 });
}

/**
 * One Durable Object and one container per visitor session: its own gateway,
 * proxy, repository and agent. Model and search keys exist only in the
 * container's root process environment; the agent runs as another user.
 */
export class OvaraSession extends DurableObject<Env> {
  #container(): Container {
    const c = this.ctx.container;
    if (!c) throw new Error('container binding missing');
    return c;
  }
  #key = () => this.ctx.id.toString();
  #quota = () => this.env.QUOTA.getByName(QUOTA_NAME);

  /** Start the container if it is not running. Does not wait for it. */
  async #start(): Promise<void> {
    const c = this.#container();
    if (c.running) return;
    const env: Record<string, string> = {};
    for (const k of ['NEBIUS_API_KEY', 'NVIDIA_API_KEY', 'TAVILY_API_KEY'] as const) if (this.env[k]) env[k] = this.env[k]!;
    if (this.env.SPEND_CAP_USD) env.OVARA_SPEND_CAP_USD = this.env.SPEND_CAP_USD;
    env.OVARA_SANDBOX_LIFETIME_SEC = String(MAX_LIFETIME_MS / 1000);
    c.start({
      image: c.images.sandbox,
      instance: 'basic',
      enableInternet: true,
      env,
      entrypoint: ['ovara', 'sandbox-serve', '-agent', this.env.LLM_PROVIDER || 'auto', '-addr', '0.0.0.0:8080'],
      labels: { app: 'ovara-sandbox' },
    });
    await c.setInactivityTimeout(IDLE_MS);
    await this.ctx.storage.put('startedAt', Date.now());
    await this.ctx.storage.setAlarm(Date.now() + MAX_LIFETIME_MS);
  }

  async #ensure(): Promise<void> {
    const c = this.#container();
    if (c.running && (await this.#up())) return;
    await this.#start();
    for (let i = 0; i < 40; i++) {
      try {
        const r = await c.getTcpPort(8080).fetch('http://sandbox/api/info');
        if (r.ok) return;
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 750));
    }
    throw new Error('the sandbox did not start');
  }

  async #up(): Promise<boolean> {
    try {
      return (await this.#container().getTcpPort(8080).fetch('http://sandbox/api/info')).ok;
    } catch {
      return false;
    }
  }

  /**
   * Boot status for the page: always answers 200 with a JSON body, so a sandbox
   * that is still starting (or a full house) is data, not a failed request.
   */
  async boot(): Promise<{ ready: boolean; code?: string; message?: string }> {
    try {
      const verdict = await this.#quota().admit(this.#key(), Number(this.env.MAX_CONCURRENT || 6), LEASE_MS, Number(this.env.SESSIONS_PER_DAY || 60));
      if (verdict === 'full') return { ready: false, code: 'full', message: 'The demo is at capacity right now. Try again in a few minutes.' };
      if (verdict === 'daily') return { ready: false, code: 'daily', message: 'The demo has reached its daily session limit. Try again tomorrow, or run it yourself: see the repository README.' };
      await this.#start();
      return { ready: await this.#up() };
    } catch (e) {
      return { ready: false, code: 'booting', message: (e as Error).message };
    }
  }

  async forward(req: Request): Promise<Response> {
    try {
      const verdict = await this.#quota().admit(this.#key(), Number(this.env.MAX_CONCURRENT || 6), LEASE_MS, Number(this.env.SESSIONS_PER_DAY || 60));
      if (verdict === 'full') return text('The demo is at capacity right now. Try again in a few minutes.', 503);
      if (verdict === 'daily') return text('The demo has reached its daily session limit. Try again tomorrow, or run it yourself: see the repository README.', 429);
      if (await this.ctx.storage.get('closeAt')) {
        await this.ctx.storage.delete('closeAt'); // a reload, not a close
        await this.#scheduleAlarm();
      }
      await this.#ensure();
      const url = new URL(req.url);
      return await this.#container().getTcpPort(8080).fetch(new Request(`http://sandbox${url.pathname}${url.search}`, req));
    } catch (e) {
      return text(`sandbox unavailable: ${(e as Error).message}`, 503);
    }
  }

  /** The tab closed: free the sandbox after a short grace unless the page comes back. */
  async closeSoon(): Promise<void> {
    if (!this.#container().running) return;
    await this.ctx.storage.put('closeAt', Date.now() + CLOSE_GRACE_MS);
    await this.#scheduleAlarm();
  }

  async #scheduleAlarm(): Promise<void> {
    const started = (await this.ctx.storage.get<number>('startedAt')) ?? Date.now();
    const closeAt = await this.ctx.storage.get<number>('closeAt');
    const end = started + MAX_LIFETIME_MS;
    await this.ctx.storage.setAlarm(closeAt ? Math.min(closeAt, end) : end);
  }

  async stop(): Promise<void> {
    const c = this.#container();
    if (c.running) await c.destroy();
    await this.ctx.storage.delete('closeAt');
    await this.#quota().release(this.#key());
  }

  async alarm(): Promise<void> {
    const started = (await this.ctx.storage.get<number>('startedAt')) ?? 0;
    const closeAt = await this.ctx.storage.get<number>('closeAt');
    const now = Date.now();
    if ((closeAt && now >= closeAt) || now >= started + MAX_LIFETIME_MS) return this.stop();
    await this.#scheduleAlarm();
  }
}

/** Slots for concurrent sandboxes, the daily session count, and a short request log. */
export class Quota extends DurableObject<Env> {
  /** Admit a session: an existing slot is renewed; a new one needs room and a daily allowance. */
  async admit(sid: string, limit: number, ttlMs: number, daily: number): Promise<'ok' | 'full' | 'daily'> {
    const now = Date.now();
    const leases = (await this.ctx.storage.get<Record<string, number>>('leases')) ?? {};
    for (const [k, exp] of Object.entries(leases)) if (exp <= now) delete leases[k];
    if (!(sid in leases)) {
      if (Object.keys(leases).length >= limit) return 'full';
      const day = new Date().toISOString().slice(0, 10);
      const c = (await this.ctx.storage.get<{ day: string; n: number }>('c')) ?? { day, n: 0 };
      if (c.day !== day) Object.assign(c, { day, n: 0 });
      if (c.n >= daily) return 'daily';
      c.n++;
      await this.ctx.storage.put('c', c);
    }
    leases[sid] = now + ttlMs;
    await this.ctx.storage.put('leases', leases);
    return 'ok';
  }

  async release(sid: string): Promise<void> {
    const leases = (await this.ctx.storage.get<Record<string, number>>('leases')) ?? {};
    delete leases[sid];
    await this.ctx.storage.put('leases', leases);
  }

  async table(): Promise<{ now: number; day: string; today: number; leases: { session: string; expiresInSec: number }[] }> {
    const now = Date.now();
    const leases = (await this.ctx.storage.get<Record<string, number>>('leases')) ?? {};
    const c = await this.ctx.storage.get<{ day: string; n: number }>('c');
    return { now, day: c?.day ?? '', today: c?.n ?? 0, leases: Object.entries(leases).map(([session, exp]) => ({ session, expiresInSec: Math.round((exp - now) / 1000) })) };
  }

  async resetStats(): Promise<{ ok: true }> {
    await this.ctx.storage.delete(['totals', 'ticker', 'seen', 'redteam']);
    return { ok: true };
  }

  /** Take one autopilot run from today's allowance. */
  async redteamAllowed(cap: number): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const f = (await this.ctx.storage.get<{ day: string; n: number }>('rt')) ?? { day, n: 0 };
    if (f.day !== day) Object.assign(f, { day, n: 0 });
    if (f.n >= cap) return false;
    f.n++;
    await this.ctx.storage.put('rt', f);
    return true;
  }

  /** A finished autopilot run, for the landing page. */
  async noteRedteam(rounds: number, escaped: number): Promise<void> {
    const t = (await this.ctx.storage.get<{ runs: number; rounds: number; escaped: number }>('redteam')) ?? { runs: 0, rounds: 0, escaped: 0 };
    t.runs++;
    t.rounds += rounds;
    t.escaped += escaped;
    await this.ctx.storage.put('redteam', t);
  }

  async clear(): Promise<void> {
    await this.ctx.storage.put('leases', {});
  }

  /** An accepted attempt. Counted once per attempt id. */
  async noteAttempt(id: string, level: number): Promise<void> {
    const seen = (await this.ctx.storage.get<string[]>('seen')) ?? [];
    if (seen.includes('a' + id)) return;
    seen.push('a' + id);
    const t = (await this.ctx.storage.get<{ attacks: number; escaped: number }>('totals')) ?? { attacks: 0, escaped: 0 };
    t.attacks++;
    await this.ctx.storage.put({ seen: seen.slice(-400), totals: t });
    void level;
  }

  /** A finished attempt: counts an escape, and feeds the ticker. Once per attempt id. */
  async noteResult(id: string, escaped: boolean, level: number, controls: string[]): Promise<void> {
    const seen = (await this.ctx.storage.get<string[]>('seen')) ?? [];
    if (seen.includes('r' + id)) return;
    seen.push('r' + id);
    const t = (await this.ctx.storage.get<{ attacks: number; escaped: number }>('totals')) ?? { attacks: 0, escaped: 0 };
    if (escaped) t.escaped++;
    const ticker = (await this.ctx.storage.get<{ t: number; level: number; control: string; escaped: boolean }[]>('ticker')) ?? [];
    ticker.push({ t: Date.now(), level, control: controls[0] ?? 'policy', escaped });
    await this.ctx.storage.put({ seen: seen.slice(-400), totals: t, ticker: ticker.slice(-12) });
  }

  /** Take one free-text attack from today's allowance. */
  async freeAllowed(cap: number): Promise<boolean> {
    const day = new Date().toISOString().slice(0, 10);
    const f = (await this.ctx.storage.get<{ day: string; n: number }>('free')) ?? { day, n: 0 };
    if (f.day !== day) Object.assign(f, { day, n: 0 });
    if (f.n >= cap) return false;
    f.n++;
    await this.ctx.storage.put('free', f);
    return true;
  }

  async publicStats(limit: number, daily: number): Promise<Record<string, unknown>> {
    const now = Date.now();
    const leases = (await this.ctx.storage.get<Record<string, number>>('leases')) ?? {};
    const live = Object.values(leases).filter((e) => e > now).length;
    const c = await this.ctx.storage.get<{ day: string; n: number }>('c');
    const day = new Date().toISOString().slice(0, 10);
    const t = (await this.ctx.storage.get<{ attacks: number; escaped: number }>('totals')) ?? { attacks: 0, escaped: 0 };
    const ticker = (await this.ctx.storage.get<unknown[]>('ticker')) ?? [];
    const redteam = (await this.ctx.storage.get<{ runs: number; rounds: number; escaped: number }>('redteam')) ?? { runs: 0, rounds: 0, escaped: 0 };
    return { attacks: t.attacks, escaped: t.escaped, redteam, live, limit, today: c?.day === day ? c.n : 0, daily_limit: daily, ticker };
  }

  async note(e: Record<string, unknown>): Promise<void> {
    const log = (await this.ctx.storage.get<Record<string, unknown>[]>('log')) ?? [];
    log.push(e);
    await this.ctx.storage.put('log', log.slice(-80));
  }

  async recent(): Promise<Record<string, unknown>[]> {
    return (await this.ctx.storage.get<Record<string, unknown>[]>('log')) ?? [];
  }
}
