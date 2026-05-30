# Agent does judgment only; autonomy is a human-gate policy, not agent orchestration

The agent is restricted to three bounded, structured-output jobs — intent→Spec, refine→Spec-delta, and Result verdicts — and never drives control flow. Fan-out, retry budget, and gate batching are deterministic orchestrator code. "Autonomous" runs (e.g. overnight rosters) mean relaxing the Human Gate policy (`per_iteration → per_batch → none` with post-hoc spot-check), *not* handing the loop to the model.

We chose this over an agentic orchestration loop (the popular default) because the runtime is a 27–31B local model that cannot reliably orchestrate, but *can* do bounded scored judgment with deterministic schema-validation on every output. This keeps autonomy and local-model viability compatible: the human can leave the per-image loop without the model ever taking over the loop. Reversing this means rebuilding the orchestrator around model-driven control flow.
