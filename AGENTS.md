# AGENTS.md

Canonical guidance for this repository lives in **[`CLAUDE.md`](./CLAUDE.md)**. Read it first,
then **[`PROGRESS.md`](./PROGRESS.md)** for the current state and next action.

Quick orientation:

| Question | File |
|---|---|
| Where is the project right now? What do I do next? | `PROGRESS.md` |
| How do I work in this repo? What are the rules? | `CLAUDE.md` |
| Why is it built this way? | `docs/superpowers/specs/2026-08-31-code-flow-p1-design.md` |
| What exactly do I implement, step by step? | `docs/superpowers/plans/2026-08-31-p1-vertical-slice.md` |
| What is this product trying to be? | `docs/product-design.md` |
| How do I get it running? | `docs/setup.md` |

Three rules worth knowing before you touch anything:

1. **The diagram is derived from the code, never the reverse.** See spec §3.
2. **`src/lib/ir/` imports no React, Next, or DOM globals.** It runs in a worker and in a Node job.
3. **Do not proceed past a failing RLS test.**
