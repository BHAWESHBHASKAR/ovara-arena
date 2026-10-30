# Devpost submission: OVARA Shift

**Track:** Coding and Agentic Engineering (also entering Best Use of Tavily)
**Demo:** https://ovara-grid.sidianlabs.workers.dev (live Shift console; full dashboard at /app, recorded session at /demo)
**Repo:** https://github.com/BHAWESHBHASKAR/ovara-arena (OVARA core: https://github.com/SidianLabs/OVARA)

## Tagline
Put a real coding agent on shift in production. OVARA sits on the wire, holds anything consequential for a human, and signs a receipt for every decision.

## The problem
Teams are starting to run coding agents unattended: nightly issue fixers, CI bots, Devin-style workers, with real tokens. These agents read untrusted text all day (GitHub issues, READMEs, web pages, tool output), and any of it can carry instructions. The damage is whatever the agent does next: upload `.env`, push to main, paste a key into a prompt. A prompt filter only sees text.

Today the choice is "trust the model" or "don't run it". I wanted a third option: run the agent, gate the consequential actions, keep the keys out of its hands, and keep a record you can verify afterwards. OVARA is the open-source gateway (Go, Apache-2.0) I built for that. OVARA Shift is the product an engineering team would actually put in front of an agent.

## What it does
OVARA Shift is an operations console. A real, unmodified open-source coding agent (OpenCode) or a Nemotron tool-calling agent works a task queue inside an OVARA sandbox (`ovara box`). Each visitor gets a private sandbox, a Cloudflare Container, with a sample Python repo (`invoice`, a library with a failing test and issue #42: totals are 100x too high), a fake `.env`, a local git origin and fixture-only networking.

Every shell command, git push, HTTP request and model call goes through OVARA:
- Reads and routine commands are allowed.
- Pushes, deploys and traffic to unknown destinations are held and appear in the Approvals inbox. The operator approves, approves and remembers, or denies.
- Paste sites and key exfiltration are blocked outright.
- OVARA holds the real Nebius and Tavily keys and injects them on egress, so the agent only ever sees a placeholder.
- Every allow, hold and block is a signed, hash-chained receipt, and the console verifies the chain live.

The console has four panels: Queue, Live feed, Approvals and Receipts.

There is also an Incident drill task. It feeds the agent a poisoned bug report with hidden instructions to upload `.env`. OVARA's taint rule and risk judge catch it. Then Nemotron 3 Ultra drafts a plain-English policy rule from the incident, OVARA validates it, and the operator applies it with one click.

## How Nemotron and Token Factory are used
All models run at runtime on Nebius Token Factory.

| Role | Model | Why this size |
|---|---|---|
| Coding agent (tool-calling: shell, git, HTTP) | `nvidia/nemotron-3-super-120b-a12b` | Multi-step fixes with tool calls |
| OpenCode's model (via OVARA's egress proxy, key injected) | `nvidia/nemotron-3-super-120b-a12b` | Runs an unmodified open-source agent on Nemotron |
| Risk judge, first pass on every request no rule covers | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Runs inline on every uncovered request, so it has to be fast and cheap |
| Risk judge escalation (hard cases, checks destination with Tavily) | `nvidia/nemotron-3-super-120b-a12b` | Takes the hard cases Nano hands up |
| Policy author (plain English to validated policy) | `nvidia/nemotron-3-super-120b-a12b` | Turns a sentence into rules that OVARA's validator then checks |
| Incident rule drafter | `nvidia/Nemotron-3-Ultra-550b-a55b` | Generalises from one incident to its family without breaking the agent's real work |

**Tavily** is used at runtime by the risk judge to check unknown destinations on the web before a verdict.

The agent never holds a Nebius or Tavily key. Its model calls go through OVARA's egress proxy, which injects the real key on the way out. A poisoned task has no real key to leak.

## How I built it
- **OVARA** (Go) runs inside each sandbox as `ovara sandbox-serve`: gateway, egress proxy, policy, taint tracking, content scanning, key custody, approvals, hash-chained signed receipts, the risk judge and the policy author.
- **Cloudflare Workers + Containers**: the Worker (`src/index.ts`) handles the session cookie and quotas, and starts one Durable Object and one container per visitor. Quotas, a daily cap, a per-sandbox spend cap and a kill switch keep a public, model-backed demo from running up a bill.
- **The console** (`public/shift.html`, served at `/`) is a single page over OVARA's APIs. `/app` is the full OVARA dashboard with the policy editor and receipts, and `/demo` is a recorded session.
- **OpenCode** runs unmodified. Its model endpoint points at OVARA's egress proxy, so it needs no special integration.
- Everything dangerous is inert: fake secrets and keys, external hosts under `.example` and `.invalid`, fixture-only networking whatever the policy says.

### Evidence
I also attacked it adaptively; here are the numbers, measured on the live deployment with each run in its own fresh sandbox. In the assume-breach run the agent carries out 18 scripted attacks: with OVARA's protections off, 9 of 18 leaked the planted secret, and with OVARA on, 0 of 18. In the adaptive run, a Nemotron attacker played against the Nemotron agent for up to 6 rounds per scenario: 0 escapes, the agent ignored the bait 42 times, and OVARA stopped the other 6.

## Challenges
- Deciding what gets held. Holding too much makes the operator approve everything without reading. The split that worked: allow reads and routine commands, hold pushes, deploys and unknown destinations, block exfiltration paths outright.
- Running an unmodified agent. OpenCode needed no changes once its model traffic went through the egress proxy with the key injected, but making every command and push pass through OVARA inside the container took most of the integration time.
- An honest baseline. "OVARA off" in the Evidence runs is a permissive preset on the same engine (no taint rule, no content scanning, no risk judge, no push approval). Key custody and the fixture-only network stay on in both modes, and the benchmark says so.
- Keeping it safe and cheap in public: fixture networks, fake secrets, spend caps.

## What I learned
- Models are already a decent first line: Nemotron 3 Super ignored most injections by itself. The gateway matters for the minority that get through, and those are the ones that would have leaked a key.
- A rule drafter writes better rules when it is shown the full incident and the control that caught it, not just the poisoned text. Ultra's rules generalised; Super's tended to block the literal string.
- Cheap-then-escalate (Nano first, Super on hard cases) kept the risk judge fast enough to sit inline on every request.
- A human approval step only works if the console shows what the action is and why it was held. The receipt and the verdict reason next to each held item did most of that work.

## What's next
- Run Shift against a team's own repo and task queue, with OpenCode in CI.
- Export and verify receipts outside the console, so an auditor can check the chain without the UI.
- Turn rules that operators apply repeatedly into OVARA's defaults.
- More agents behind the same sandbox: any agent that speaks HTTP and runs shell commands should work.

## What changed during the submission period
OVARA's gateway predates the hackathon. Built during the submission period: the per-visitor Cloudflare sandboxes, Nemotron on Nebius as the agent, risk judge and policy author, OpenCode running through OVARA's egress proxy with key injection, and the Shift console itself: the task queue, live feed, Approvals inbox and live receipt verification, plus the Incident drill with the Nemotron 3 Ultra rule drafter and the benchmark.

## Feedback on Nebius Token Factory and NVIDIA models
(Keep only what matches your experience.)
- Model id casing is inconsistent across the catalogue: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` vs `nvidia/nemotron-3-super-120b-a12b` vs `nvidia/Nemotron-3-Ultra-550b-a55b`. One convention would save a lot of copy-paste errors.
- Reasoning content: Super and Ultra sometimes return `<think>` blocks inside `content` rather than only in `reasoning_content`, so every caller has to strip them. A flag to suppress reasoning in `content` would help.
- 429s and 5xx under burst: I had to add retry with backoff on every call. Published per-model rate limits and a `Retry-After` header would make capacity planning easier.
- JSON output: strict JSON came back reliably from Super with a clear schema in the system prompt, less reliably from Nano. A response-format parameter enforced server-side would remove the parsing fallbacks.
- What worked well: the OpenAI-compatible endpoint meant zero SDK work, and Nano is cheap and fast enough to run inline on every gateway request, which made the cheap-then-escalate judge design possible.
