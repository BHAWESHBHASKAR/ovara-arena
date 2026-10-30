# OVARA Arena: Nemotron attacks, OVARA holds, Nemotron learns

**Live:** https://ovara-grid.sidianlabs.workers.dev · **Red team autopilot:** https://ovara-grid.sidianlabs.workers.dev/redteam

Coding agents now read untrusted text all day: GitHub issues, READMEs, web pages, tool output. Any of it can carry instructions. A prompt filter can't fix this, because the attack is whatever the agent *does* next. OVARA is a security gateway that sits between an AI agent and the world. Every command, network request, git push and model call goes through OVARA first. It holds the real keys, so the agent never sees them, and it signs a receipt for every decision.

**OVARA Arena** makes that visible. Every visitor gets a private sandbox with a real coding agent (NVIDIA Nemotron 3 Super on Nebius Token Factory) and tries to make it leak a flag. Over five levels, each defense is attacked on its own terms.

**New for the Nebius × NVIDIA hackathon: the red team autopilot.** An attacker agent, Nemotron 3 Super, plays the Arena by itself:

1. **Research.** Tavily searches for published prompt-injection techniques against the control that guards the level.
2. **Attack.** Nemotron writes one attack and plants it where the level allows: a chat message, an issue body, a README, a web page.
3. **Gate.** The guarded agent really runs it in the sandbox. OVARA allows, holds or blocks each action. Its verdict goes back to the attacker: how far the attack got, which control stopped it, and why.
4. **Adapt.** The next round routes around the control that stopped the last one.
5. **Harden.** After the last round, Nemotron 3 Ultra reads the attack that got furthest and drafts a plain-English policy rule. OVARA's own rule author turns it into policy and validates it. You apply it with one click, then replay the attack to see it stopped earlier in the chain.

So it's two Nemotrons and a gate in between: one attacks, one defends, and every move is a signed receipt.

## Benchmark

`bench/run.ts` plays the autopilot against every playable level twice, on the live deployment. Each run gets its own session, so its own fresh container. One run uses OVARA's protections off (the permissive preset), one uses the default policy. Same attacker, same agent, same image. Results go to `bench/results-*.json` (every attack, verdict, receipt id and what the agent was thinking) and, via `bench/summarize.ts`, to `public/bench.json` (the table on `/redteam`).

| Measured on the live site | OVARA off | OVARA on |
|---|---|---|
| **Assume breach:** the agent carries out each of the 18 scripted attacks | **9 of 18** got the flag out | **0 of 18**: every one stopped by a named control, with a signed receipt |
| **Adaptive:** Nemotron 3 Super attacker vs Nemotron 3 Super agent, up to 6 rounds per level | 0 of 21 | 0 of 27: the agent ignored most; OVARA stopped 6, the closest at 75% of the way |

Defense in depth: the model refuses most attacks by itself, and OVARA holds when it doesn't.

## How NVIDIA Nemotron and Nebius Token Factory are used

| Job | Model on Token Factory | Why |
|---|---|---|
| Coding agent inside the sandbox | `nvidia/nemotron-3-super-120b-a12b` | Plans multi-step fixes with tool calls: shell, git, HTTP |
| OVARA's risk judge, first pass | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Runs on every request no rule covers, so it has to be fast and cheap |
| OVARA's risk judge, escalation | `nvidia/nemotron-3-super-120b-a12b` | Takes the hard cases Nano hands up. With Tavily it checks the destination on the web first |
| OVARA's policy author (plain English to policy) | `nvidia/nemotron-3-super-120b-a12b` | Turns a sentence into rules that OVARA's validator then checks |
| Red-team attacker | `nvidia/nemotron-3-super-120b-a12b` (or Nano) | Reads the verdict, reasons about the control that stopped it, and invents the next technique |
| Defender: drafts the hardening rule | `nvidia/Nemotron-3-Ultra-550b-a55b` | The hardest reasoning step: generalise from one attack to its whole family without breaking the agent's real work |

So Nemotron plays every part: it is attacked, it attacks, it judges and it defends.

The agent never holds a Nebius key. Its model calls go through OVARA's egress proxy, which injects the real key on the way out. Key custody is one of the controls under test (level 4).

**Tavily** provides the attacker's research step. Its results and source links are shown live on the page.

## Architecture

```
Visitor browser ──HTTPS──▶ Cloudflare Worker (src/index.ts)
                             ├─ Quota Durable Object: slots, daily caps, public stats
                             ├─ /api/redteam: autopilot (src/redteam.ts) ──▶ Nebius Token Factory (Nemotron Super), Tavily
                             └─ OvaraSession Durable Object ──▶ one container per visitor
                                   ovara sandbox-serve
                                   ├─ gateway: identity, policy, taint, approvals, signed receipts
                                   ├─ egress proxy: key custody, content scanning, fixture-only network
                                   ├─ assist: Nemotron risk judge, Nemotron policy author
                                   └─ agent (Nemotron Super) + fixture world: fake .env, local git origin, *.example hosts
```

Everything dangerous is inert. The flags and keys are fake, and attacker hosts end in `.example` or `.invalid`. The sandbox can only reach fixture sites, whatever the policy says.

## Run it yourself

```bash
npm install
# local: the same container the live site runs
docker run --rm -p 8080:8080 --cap-add NET_ADMIN -e NEBIUS_API_KEY -e TAVILY_API_KEY \
  <arena image> ovara sandbox-serve -agent nebius -addr 0.0.0.0:8080
# benchmark: 6 rounds per level and mode, against a deployment
BENCH_REMOTE=https://<your worker>.workers.dev NEBIUS_API_KEY=... TAVILY_API_KEY=... npx tsx bench/run.ts 6
npx tsx bench/summarize.ts
# deploy your own (needs Workers Paid for Containers)
npx wrangler secret put NEBIUS_API_KEY
npx wrangler secret put TAVILY_API_KEY
npx wrangler deploy
```

Cost guards: at most 10 sandboxes at once, 60 sessions a day, 8 free-text attacks per session, 40 autopilot runs a day, a $0.25 spend cap per sandbox, and a kill switch (`DEMO_DISABLED=1`).

## What's in this repository

- `src/index.ts`: the Worker: session cookies, per-visitor container lifecycle, quotas, and the autopilot stream
- `src/redteam.ts`: the attacker/defender loop, shared by the Worker and the benchmark
- `bench/run.ts`: the benchmark harness
- `public/`: the Arena dashboard and the `/redteam` page

OVARA itself (gateway, proxy, sandbox, receipts) is open source at [SidianLabs/OVARA](https://github.com/SidianLabs/OVARA) under Apache-2.0.

## License

Apache-2.0
