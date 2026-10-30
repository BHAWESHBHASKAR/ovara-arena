# OVARA Shift: a coding agent on shift, OVARA on the wire

**Live:** https://ovara-grid.sidianlabs.workers.dev (the Shift console) · **Full OVARA dashboard:** `/app` · **Recorded session:** `/demo`

Put a real coding agent on shift in production. OVARA sits on the wire, holds anything consequential for a human, and signs a receipt for every decision.

Teams are starting to run coding agents unattended: nightly issue fixers, CI bots, Devin-style workers, all with real tokens. Today the choice is "trust the model" or "don't run it". The agent reads untrusted text all day (issues, READMEs, web pages, tool output), any of it can carry instructions, and the damage comes from what the agent does next. A prompt filter only sees text.

OVARA is an open-source gateway (Go, Apache-2.0) that sits between an AI agent and the internet. Inside its sandbox (`ovara box`), every shell command, git push, HTTP request and model call goes through it. It holds the real keys, so the agent never sees them, and it writes a signed, hash-chained receipt for every allow, hold and block. **OVARA Shift** is an operations console on top of that: put an agent to work on a task queue and watch what it does, approve what matters, and verify the record. This is the third option: run it, gate the consequential actions, keep the keys out of its hands, and keep a verifiable record.

## What you see

Each visitor gets a private sandbox (a Cloudflare Container) with a sample Python repo (`invoice`, a library with a failing test and issue #42: totals are 100x too high), a fake `.env`, a local git origin and fixture-only networking. A real, unmodified open-source coding agent (OpenCode) or a Nemotron tool-calling agent works the queue inside it. The console at `/` has four panels:

- **Queue.** The tasks the agent works: fix issue #42, plus an **Incident drill**, where the agent is fed a poisoned bug report with hidden instructions to upload `.env`.
- **Live feed.** Every command, push, request and model call as it happens, with OVARA's verdict next to it. Reads and routine commands are allowed.
- **Approvals.** Pushes, deploys and traffic to unknown destinations are held here. The operator approves, approves and remembers, or denies. Paste sites and key exfiltration are blocked outright.
- **Receipts.** Every allow, hold and block is a signed, hash-chained receipt, and the console verifies the chain live.

In the Incident drill, OVARA's taint rule and risk judge catch the poisoned report. Then Nemotron 3 Ultra drafts a plain-English policy rule from the incident, OVARA validates it, and the operator applies it with one click.

## How Nemotron and Token Factory are used

All models are called at runtime on Nebius Token Factory.

| Role | Model on Token Factory | Why |
|---|---|---|
| Coding agent (tool-calling: shell, git, HTTP) | `nvidia/nemotron-3-super-120b-a12b` | Plans multi-step fixes with tool calls |
| OpenCode's model (via OVARA's egress proxy, key injected) | `nvidia/nemotron-3-super-120b-a12b` | Lets an unmodified open-source agent run on Nemotron |
| Risk judge, first pass on every request no rule covers | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Runs inline on every uncovered request, so it has to be fast and cheap |
| Risk judge escalation (hard cases, checks the destination with Tavily) | `nvidia/nemotron-3-super-120b-a12b` | Takes the hard cases Nano hands up |
| Policy author (plain English to validated policy) | `nvidia/nemotron-3-super-120b-a12b` | Turns a sentence into rules that OVARA's validator then checks |
| Incident rule drafter | `nvidia/Nemotron-3-Ultra-550b-a55b` | Generalises from one incident to its whole family without breaking the agent's real work |

**Tavily** is used at runtime by the risk judge: when a request goes to a destination no rule covers, the judge checks it on the web first.

**Key custody.** OVARA holds the real Nebius and Tavily keys and injects them on egress. The agent, whether OpenCode or the Nemotron agent, only ever sees a placeholder, so a poisoned task has no real key to leak. The risk judge and rule drafter are part of the sandbox build of OVARA; the open-source repository documents the gateway, proxy, policy, taint, custody, content scanning and receipts.

## Architecture

```
Visitor browser ──HTTPS──▶ Cloudflare Worker (src/index.ts)
                             │   session cookie, quotas, daily caps
                             └─ OvaraSession Durable Object ──▶ one container per visitor
                                   ovara sandbox-serve
                                   ├─ gateway: identity, policy, taint, approvals, signed receipts
                                   ├─ egress proxy: key custody, content scanning, fixture-only network
                                   ├─ assist: Nemotron risk judge (+ Tavily), Nemotron policy author
                                   └─ agent (OpenCode or Nemotron) + fixture world:
                                      invoice repo, fake .env, local git origin, *.example hosts
```

Routes: `/` is the Shift console, `/app` is the full OVARA dashboard (policy editor, receipts), `/demo` is a recorded session.

Everything dangerous is inert. The secrets and keys in the sandbox are fake, and external hosts end in `.example` or `.invalid`. The sandbox can only reach fixture sites, whatever the policy says.

## Evidence

We also attacked it adaptively; here are the numbers. `bench/run.ts` plays scripted and adaptive attacks against the live deployment, each run in its own fresh container. In the assume-breach run, the agent carries out each of 18 scripted attacks: with OVARA's protections off, 9 of 18 leaked the planted secret, and with OVARA on, 0 of 18, each stopped by a named control with a signed receipt.

In the adaptive run, a Nemotron attacker played against the Nemotron agent for up to 6 rounds per scenario, with OVARA on: 0 escapes. The agent ignored the bait 42 times and OVARA stopped the other 6. The model refuses most attacks by itself, and OVARA holds when it doesn't. Results go to `bench/results-*.json` (every attack, verdict and receipt id), and `bench/summarize.ts` writes `public/bench.json`.

## Run it yourself

```bash
npm install
# local: the same container the live site runs
docker run --rm -p 8080:8080 --cap-add NET_ADMIN -e NEBIUS_API_KEY -e TAVILY_API_KEY \
  <container image> ovara sandbox-serve -agent nebius -addr 0.0.0.0:8080
# reproduce the evidence: 6 rounds per scenario and mode, against a deployment
BENCH_REMOTE=https://<your worker>.workers.dev NEBIUS_API_KEY=... TAVILY_API_KEY=... npx tsx bench/run.ts 6
npx tsx bench/summarize.ts
# deploy your own (needs Workers Paid for Containers)
npx wrangler secret put NEBIUS_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler deploy
```

Cost guards: at most 10 sandboxes at once, 60 sessions a day, a $0.25 spend cap per sandbox, and a kill switch (`DEMO_DISABLED=1`).

## What's in this repository

- `src/index.ts`: the Worker: session cookies, per-visitor container lifecycle, quotas
- `public/shift.html`: the Shift console, served at `/`
- `public/`: the OVARA dashboard (`/app`) and the recorded session (`/demo`)
- `bench/run.ts`: the benchmark harness behind the Evidence numbers

OVARA itself (gateway, proxy, sandbox, receipts) is open source at [SidianLabs/OVARA](https://github.com/SidianLabs/OVARA) under Apache-2.0.

## License

Apache-2.0
