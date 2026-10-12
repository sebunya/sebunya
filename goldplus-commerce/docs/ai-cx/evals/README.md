# Evaluation set and simulations

- `questions.json` — 108 synthetic questions (grounded 60, language 20, failure 11, abuse 9,
  sensitive 8) with the route each must take. Run by `tests/unit/AssistantEvals.test.ts`;
  81 % are deterministic (87/108). Not mined from real conversations: none are stored.
- `simulation-output-2026-10-12.txt` — output of `pnpm exec tsx scripts/qa/assistant-cost-simulation.ts`
  (1,000-session normal and stress months, four-and-reset, botnet, flood, past-the-cap Sybil),
  pinned by `tests/unit/AssistantCostSimulation.test.ts`. Mock usage; no provider call.
- Rubric for the 21 model-routed questions (manual, before launch): fact traceable to a tool
  result; no invented price/stock/fit/fee; one clarification at most; a product link or a
  support path offered; under five sentences. Record results in 03 when run with a real key.
