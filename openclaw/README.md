# Langclaw OpenClaw Workflow

Langclaw uses this folder as the OpenClaw skill workspace.

OpenClaw acts as the agent reasoning and orchestration layer. It does not call X, GitHub, Tavily, Brave Search, or HackQuest directly. The Next.js server keeps those provider tools in TypeScript so API keys stay server-side.

Langclaw reads each local skill file and runs these reasoning steps through `openclaw agent --json`:

- Planner Agent
- Trend Scorer Agent
- Evidence Packager Agent
- Verifier Agent
- Final Conclusion Agent

Discovery and Source Normalizer stay as TypeScript tools. That keeps provider credentials outside the agent prompt while still showing a real OpenClaw-driven workflow.

Current X discovery defaults to Brave Search. The official X API remains available behind `X_DISCOVERY_PROVIDER=x-api`.

The public API calls `runLangclawWorkflow(topic)`. That workflow routes the topic through these skills:

1. Planner Skill
2. Discovery Skill
3. Source Normalizer Skill
4. Trend Scorer Skill
5. Evidence Packager Skill
6. Verifier Skill
7. Final Conclusion Skill

Default runtime:

```text
OPENCLAW_ENABLED=true
OPENCLAW_WORKFLOW_ENABLED=true
OPENCLAW_AI_SYNTHESIS=true
OPENCLAW_STEP_TIMEOUT_SECONDS=60
OPENAI_API_KEY=
OPENAI_AGENT_MODEL=gpt-5.2
```

With the default setting, Langclaw probes the OpenClaw CLI, runs the reasoning steps through OpenClaw when available, returns execution metadata for each step, and uses OpenClaw for the final chat answer when `OPENCLAW_AI_SYNTHESIS=true`. OpenAI remains the fallback path if the OpenClaw final synthesis step is disabled or fails.

Optional runtime:

```text
OPENCLAW_ENABLED=true
OPENCLAW_CLI_PATH=openclaw
OPENCLAW_WORKFLOW_ENABLED=true
OPENCLAW_AI_SYNTHESIS=true
OPENCLAW_STEP_TIMEOUT_SECONDS=60
OPENCLAW_MODEL=
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_AGENT_MODEL=gpt-5.2
```

When enabled, Langclaw probes the OpenClaw CLI. If the CLI responds, the API marks the run as `runtime: "openclaw"`. If the CLI is missing, the API falls back to `runtime: "typescript"` and keeps the run live.

If an OpenClaw step fails, the API still returns deterministic fallback output and marks that step as `execution: "deterministic-fallback"`. The evidence and verifier steps prepare proof fields only. They do not claim that a Mantle transaction has happened unless the registry transaction is actually submitted or confirmed.

The Mantle proof work runs after the reasoning steps:

- `src/lib/openai-direct-chat.ts` calls OpenAI Responses API for direct chat.
- `src/lib/langclaw/openai-synthesis.ts` calls OpenAI Responses API for final-answer inference.
- `src/lib/langclaw/proof.ts` prepares the canonical evidence bundle hash and anchors the agent decision through `LangclawRegistry` when `MANTLE_CHAIN_ENABLED=true`.

If those envs are missing, the response stays honest and marks the proof as `prepared` or `failed` instead of claiming a chain transaction.
