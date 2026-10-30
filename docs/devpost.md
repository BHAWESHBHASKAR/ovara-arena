# Devpost submission: OVARA Arena

**Track:** Coding and Agentic Engineering (also entering Best Use of Tavily)
**Demo:** https://ovara-grid.sidianlabs.workers.dev (opens on a real recorded attack; flip OVARA OFF, then press "Run it live")
**Repo:** https://github.com/BHAWESHBHASKAR/ovara-arena (OVARA core: https://github.com/SidianLabs/OVARA)

## Tagline
Nemotron attacks. OVARA holds. Nemotron learns.

## Inspiration
Coding agents now read untrusted text all day: issues, READMEs, web pages, tool output. Any of it can carry orders, and the damage is whatever the agent does next: an upload of `.env`, a push to main, a key pasted into a prompt. I built OVARA, an open-source gateway that the agent's network requests, and inside its sandbox its commands, pushes and model calls, go through. A gateway is only as good as the attacks it has seen, though, and attackers adapt. So I wanted a defender attacked repeatedly by a model that adapts.

## What it does
OVARA Arena gives every visitor a private sandbox with a real coding agent (NVIDIA Nemotron 3 Super on Nebius Token Factory) and five levels, each guarded by a different OVARA control: policy and a risk judge, the taint rule, content scanning, credential custody, and scanning of model calls. You try to make the agent leak a fake flag.

The new part is the **red team autopilot**:
1. **Research:** Tavily finds published prompt-injection techniques against the control that guards the level.
2. **Attack:** Nemotron 3 Super writes an attack and plants it where the level allows.
3. **Gate:** the guarded agent really runs it. OVARA allows, holds or blocks every action and signs a receipt.
4. **Adapt:** OVARA's verdict goes back to the attacker: how far it got, which control stopped it, and why. The next round routes around that control.
5. **Harden:** Nemotron reads the attack that got furthest and drafts a policy rule. OVARA's validator checks it, you apply it with one click, and a replay of the attack is stopped earlier in the chain.

Nemotron models fill four roles: the coding agent, the attacker, the risk judge and the rule drafter.

## Benchmark
Measured on the live deployment, each run in its own fresh sandbox:

- **Assume breach.** The agent is made to carry out every scripted attack in the Arena (18 across 5 levels). With OVARA's protections off, **9 of 18** got the flag out. With OVARA's default policy, **0 of 18** did. Every one was stopped by a named control with a signed receipt: the risk judge, policy, the taint rule, content scanning, key custody and push approval each caught at least one.
- **Adaptive.** Nemotron 3 Super attacked a Nemotron 3 Super agent for up to 6 rounds per level, learning from every verdict, with OVARA off and on. **0 of 48** completed attacks got the flag out. The agent ignored the bait 42 times; OVARA stopped the other 6 (its closest attempts reached 75% of the way before a control held).

That is defense in depth: Nemotron itself ignores most attacks, and OVARA catches the ones that get through.

## How I built it
- **Nebius Token Factory** serves all the models: Nemotron 3 Super for the agent, the attacker, the defender and the policy author, and Nemotron 3 Nano for the first pass of the risk judge, which runs on every request no rule covers. The judge escalates hard cases from Nano to Super, so cheap calls stay cheap and hard calls get reasoning.
- **OVARA** (Go) runs inside each sandbox: gateway, egress proxy, policy, taint tracking, content scanning, key custody and hash-chained signed receipts. The agent never holds a real key. OVARA injects the Nebius key on the way out, so even the agent's own model calls go through the gate.
- **Cloudflare Workers + Containers:** one Durable Object and one container per visitor, plus quotas, a daily cap and a kill switch, so a public demo can't run up a bill.
- **Tavily** powers the attacker's research step, and the judge's web evidence when a destination is unknown.
- The autopilot (`src/redteam.ts`) is one loop shared by the live page and the benchmark harness, so the numbers on the page come from the same code visitors run.

## Challenges
- Making the attacker actually learn. What worked was feeding back OVARA's *structured* verdict: the stages reached, the decisive control and its reason, rather than just pass or fail.
- Keeping a live, public, model-backed security demo safe and cheap: fixture-only networking, fake secrets, per-sandbox spend caps and global daily caps.
- Being honest about the baseline. "OVARA off" is the arena's permissive preset on the same engine (no taint rule, no content scanning, no risk judge, no push approval); key custody and the fixture-only network stay on in both modes. The benchmark says so.

## What I learned
CONFIRM_WITH_BHAWESH

## What's next
- Run the autopilot every night against every level, and turn the rules that hold up into OVARA's defaults.
- Levels 6–8: tool pinning (a tool that rewrites its own description), request-bound approvals, and a boss level.
- Ship the autopilot as `ovara redteam` in the OVARA CLI, so teams can attack their own agent setups.

## What changed during the submission period
OVARA's gateway predates the hackathon. Built during the submission period: the Arena (per-visitor Cloudflare sandboxes, five levels, story mode, live policy editing), Nemotron on Nebius as the agent, judge and policy author, and on the final day the red team autopilot, the Nemotron defender, the Tavily research step and the benchmark.

## Feedback on Nebius Token Factory and NVIDIA models
CONFIRM_WITH_BHAWESH (Most Valuable Feedback prize: give real notes from your own use: sign-up and billing, the promo codes, model naming such as `NVIDIA-Nemotron-3-Nano-30B-A3B` vs `nemotron-3-super-120b-a12b` casing, latency, JSON output reliability.)
