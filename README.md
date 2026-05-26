# Langclaw Backend

Node.js HTTP API (`langclaw-backend`) for **Langclaw Celo Alpha Sentinel**: Celo-first on-chain intelligence with MiniPay support for agent proof, USDT-backed usage billing, and eligibility operations.

**Product chain:** Celo mainnet `42220` · **Default billing asset:** Celo USDT · **Proof:** Celo `LangclawRegistry`

## Responsibilities

- **Strategy Lab** - Dune-backed Celo liquidity momentum backtests, paper trades, and trading journal proofs.
- **Celo Alpha**: `runLangclawWorkflow(topic)` via `POST /api/discover` and `/api/discover/stream`
- **Chat**: `POST /api/chat/stream`, session sync to Supabase
- **Account**: wallet auth, API keys (HMAC), memory, automation, usage ledger
- **Proof**: evidence bundles and Celo `LangclawRegistry` agent decision records
- **Research reports**: deterministic report objects with ranked entities, tables, caveats, and recommendations.
- **On-chain tools**: Surf-first smart-money research with Dune SQL and Nansen fallback, plus DEX Screener, DeFiLlama, Alchemy, Etherscan-style, GoPlus, CoinGecko, GeckoTerminal, Elfa, and local synthesis.

## Local setup

```bash
cp .env.example .env
npm install
npm run dev
```

Default: **http://localhost:3001**

```bash
curl http://localhost:3001/health
```

Production:

```bash
npm run build && npm start
```

## HTTP routes

Defined in [`src/server.ts`](src/server.ts):

| Area | Endpoints |
| ---- | --------- |
| Health | `GET /health` |
| Research | `POST /api/discover`, `POST /api/discover/stream` |
| Strategy Lab | `POST /api/strategy/backtest`, `scan-pairs`, `paper-trade`, `runs` |
| Chat | `POST /api/chat/stream`, `POST /api/chat/sessions` |
| Memory | `POST /api/memory`, `POST /api/memory/settings` |
| API keys | `POST /api/api-keys` |
| Usage | `POST /api/usage/balance`, `quote`, `deposit/verify`, `withdraw/request` |
| Automation | `POST /api/automation/*`, webhooks, Telegram |
| Proof | `POST /api/proofs/decisions`, `POST /api/proofs/readiness` |

Full request/response shapes: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

Chat and research routes require both a wallet session and a linked Telegram chat. Users can link Telegram from automation notification settings before running the agent.

## Langclaw + OpenClaw

OpenClaw runs reasoning steps (`openclaw agent --json`); discovery and provider calls stay in TypeScript.

```text
runLangclawWorkflow(topic)
  → Planner (OpenClaw)
  → Discovery (TS: Surf, Elfa, X/Brave, GitHub, Tavily, HackQuest)
  → Combined signals (TS: social, onchain, combined summaries)
  → Structured report (TS: deterministic report core with ranked tables when real metrics exist)
  → Source normalizer (TS)
  → On-chain enrichment (TS: Surf, Dune, Nansen, DEX Screener, DeFiLlama, Alchemy, Etherscan, GoPlus by scope)
  → Celo alpha scorer (OpenClaw)
  → Evidence packager (OpenClaw)
  → Verifier (OpenClaw)
  → Final conclusion (OpenAI Responses → deterministic fallback)
  → Evidence bundle → LangclawRegistry agent decision proof on Celo
```

Skills: [`openclaw/skills/`](openclaw/skills/). See [`openclaw/README.md`](openclaw/README.md).

X discovery defaults to Brave (`X_DISCOVERY_PROVIDER=brave`). Use `x-api` only with `X_BEARER_TOKEN` and credits.

### OpenClaw install (optional, recommended for demos)

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
openclaw onboard --install-daemon
openclaw doctor
```

Env (see `.env.example`):

```bash
OPENCLAW_ENABLED=true
OPENCLAW_WORKFLOW_ENABLED=true
OPENCLAW_AI_SYNTHESIS=true
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_AGENT_MODEL=gpt-5.2
```

## Environment

Copy [`.env.example`](.env.example). Minimum for a useful dev server:

| Variable | Purpose |
| -------- | ------- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Persistence |
| `LANGCLAW_API_KEY_PEPPER` | API key hashing |
| `OPENAI_API_KEY` | Direct chat and final answer synthesis |
| `CORS_ORIGIN` | Frontend origin (default `http://localhost:3000`) |

Langclaw providers: `BRAVE_SEARCH_API_KEY`, `GITHUB_TOKEN`, `TAVILY_API_KEY`, …

Celo premium intelligence rollout: `SURF_ENABLED`, `SURF_API_KEY`, `ELFA_ENABLED`, `ELFA_API_KEY`, plus optional `*_TIMEOUT_MS` overrides. Shared research runs default to a combined workflow: Surf feeds social/public research and is the primary smart-money ability provider, Dune is the row-level SQL fallback, and legacy/public providers remain as supplemental context. Nansen remains available only for explicit Mantle analysis.

Research payloads now also expose additive `report` and `alphaSignal` objects. `report` is provider-agnostic and deterministic: the backend computes report kind, ranked entities, tables, narrative sections, caveats, and recommendations from the current run's normalized evidence. `alphaSignal` adds a score, evidence count, source coverage, and false positive checks without changing existing response fields. When the run does not include direct row-level metrics, the report stays narrative-first instead of fabricating a leaderboard.

Alpha alerts: `.env.example` enables `LANGCLAW_ALPHA_ALERTS_ENABLED=true`. Set `LANGCLAW_TELEGRAM_BOT_TOKEN` and let users link Telegram from settings. `LANGCLAW_AUTOMATION_TELEGRAM_CHAT_ID` is only a fallback global chat for demo or server-level alerts. The alert gate requires Celo scope, on-chain evidence, enough source coverage, and no blocking false positive check.

Celo/Mantle proof: `MANTLE_CHAIN_*`, `CELO_CHAIN_*`, `{MANTLE,CELO}_AGENT_PRIVATE_KEY`, `{MANTLE,CELO}_AGENT_WALLET`, `{MANTLE,CELO}_ERC8004_AGENT_ID`, `{MANTLE,CELO}_LANGCLAW_REGISTRY_ADDRESS`. Runtime proof/journal transactions prefer the agent key; `{MANTLE,CELO}_PRIVATE_KEY` remains a fallback. Celo transactions use the configured USDT fee-currency adapter when supported, then fall back to native CELO fee payment if the adapter path is not usable. Mantle legacy `LANGCLAW_REGISTRY_ADDRESS` remains supported.

Celo ERC-8004 reputation: set `CELO_ERC8004_REPUTATION_ENABLED=true` plus `CELO_ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY` to submit `giveFeedback(...)` after a Langclaw decision proof anchors. Use a feedback key that is not the agent recorder key.

Core chain data sources: `DUNE_API_KEY`, optional legacy `DUNE_DEFAULT_QUERY_ID`, `DUNE_SQL_PERFORMANCE`, `DUNE_SQL_TIMEOUT_MS`, `DUNE_STRATEGY_QUERY_ID`, `ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`, `GOPLUS_*`; DEX Screener and DeFiLlama work without keys for public endpoints. Smart-money routing is Surf -> Dune, with Nansen only for explicit Mantle fallback. Surf uses backend skill abilities through the API. Dune executes generated DEX and CEX flow SQL from safe chain, token, timeframe, and threshold parameters. If Surf API balance is exhausted, `SURF_CLI_FALLBACK_ENABLED=true` lets the backend try the local Surf CLI for `search-web` and mapped `onchain-sql` calls before falling through to Dune. Dune does not need a saved query id unless the user explicitly asks for a Dune query id. GoPlus is skipped on Celo because the live provider does not support Celo mainnet in this workflow. The shared workflow always returns `signals.social`, `signals.onchain`, `signals.combined`, and an additive `report`; outside Celo premium scope those sections fall back or mark honest skips/failures instead of changing the payload shape.

### Smart-money research behavior

Smart-money requests preserve the user scope before choosing providers:

- Chain-level prompts such as `Find smart-money accumulation on Celo` stay chain-level first.
- Token-level prompts such as `Find smart-money accumulation for CELO on Celo` can use token-specific context.
- Token activity on another chain is never treated as equivalent to chain activity.
- Celo chain activity is not Ethereum token activity.
- Arbitrum chain activity is not ARB token activity on Ethereum.

The smart-money provider route is:

1. Surf Chat Completions with `evm_onchain`, `market_analysis`, `search`, and `calculate` abilities.
2. Surf local CLI fallback for mapped `search-web` and `onchain-sql` calls when the Surf API reports exhausted credits or balance.
3. Dune dynamic SQL for row-level DEX buys and CEX withdrawals.
4. Nansen smart-money netflow only for explicit Mantle fallback.
5. Local synthesis as analysis-only fallback.

Report rules:

- DEX-only rows are labeled as large-flow watchlists, not confirmed smart money.
- Confirmed smart money requires wallet labels plus retention or behavior checks.
- Evidence and candidate tables are rendered only when row-level rows exist.
- Stablecoins and wrapped majors are bucketed separately from non-stable token accumulation.
- Final answers hide raw provider errors, billing state, HTTP details, CLI flags, and fallback internals.
- Response language follows the user's prompt language when detected.

Strategy Lab proof: `{MANTLE,CELO}_LANGCLAW_TRADING_JOURNAL_ADDRESS`, `{MANTLE,CELO}_TRADING_JOURNAL_ENABLED`, and optional `{MANTLE,CELO}_TRADING_JOURNAL_DEPLOY_BLOCK`. Mantle legacy `LANGCLAW_TRADING_JOURNAL_ADDRESS` remains supported. Without these, backtests still run and return a `prepared` proof state instead of pretending to be anchored.

Billing: `{MANTLE,CELO}_LANGCLAW_USAGE_VAULT_ADDRESS`. Mantle legacy `LANGCLAW_USAGE_VAULT_ADDRESS` remains supported.

## Current Celo verification

| Item | Current value |
| ---- | ------------- |
| Celo chain | Mainnet `42220` |
| Agent wallet | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| ERC-8004 agent ID | `9109` |
| ERC-8004 registration tx | `0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3` |
| Self Agent ID | `133` |
| Self Agent ID tx | `0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6` |
| Latest decision proof | Decision `#1`, signal `smart-money`, agent `133` |
| Latest decision proof tx | `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

Run `npm run check:eligibility` to verify the live Celo contracts, ERC-8004 agent, and Self Agent ID status. A verified Self Agent ID transaction satisfies the Self human proof check. Raw `CELO_SELF_HUMAN_PROOF` and `CELO_SELF_HUMAN_PROVIDER_DATA` are only needed when registering through the local script instead of the official Self linked flow.

## Supabase

Apply migrations under [`supabase/migrations/`](supabase/migrations/). Clients never write directly; the server uses the service role key.

## Smart contracts

| Contract | Deploy | Env |
| -------- | ------ | --- |
| `LangclawUsageVault` | `npm run deploy:usage-vault -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_DEPLOYER_PRIVATE_KEY`; writes `{MANTLE,CELO}_LANGCLAW_USAGE_VAULT_ADDRESS` |
| `LangclawRegistry` | `npm run deploy:registry -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_DEPLOYER_PRIVATE_KEY`; writes `{MANTLE,CELO}_LANGCLAW_REGISTRY_ADDRESS` |
| `LangclawTradingJournal` | `npm run deploy:trading-journal -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_DEPLOYER_PRIVATE_KEY`; writes `{MANTLE,CELO}_LANGCLAW_TRADING_JOURNAL_ADDRESS`, `{MANTLE,CELO}_TRADING_JOURNAL_ENABLED` |
| ERC-8004 agent identity | `npm run register:agent -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_AGENT_PRIVATE_KEY`; writes `{MANTLE,CELO}_ERC8004_AGENT_ID`, `{MANTLE,CELO}_AGENT_WALLET`, `{MANTLE,CELO}_AGENT_ONCHAIN_TX` |
| Self Agent ID | Official Self linked registration flow or `npm run register:agent -- --chain celo --self-agent-id --write-env` | Current verified Celo ID is `133`. The official flow writes on-chain proof through Self. The local script needs `CELO_SELF_HUMAN_PROOF` and `CELO_SELF_HUMAN_PROVIDER_DATA` only when registering directly from this repo. |

Registry source: [`../contracts/src/LangclawRegistry.sol`](../contracts/src/LangclawRegistry.sol)

`LangclawRegistry` records agent decisions with `agentId`, `runId`, `decisionHash`, `evidenceUri`, `signalType`, recorder, and timestamp. This is the selected-chain proof layer for AI Alpha & Data judging.

`LangclawTradingJournal` records strategy backtests and paper trades with `agentId`, `runId`, `strategyId`, market, action, PnL bps, status, evidence URI, and deterministic decision/result hashes. This is the selected-chain proof layer for AI Trading & Strategy without live-funds risk.

Deposit verification: [`src/lib/usage.ts`](src/lib/usage.ts) → `POST /api/usage/deposit/verify`

Vault spec: [`docs/SMART_CONTRACT_TEAM_NOTES.md`](docs/SMART_CONTRACT_TEAM_NOTES.md)

Eligibility runbook: [`docs/CELO_ELIGIBILITY.md`](docs/CELO_ELIGIBILITY.md)

MiniPay payout checklist: [`docs/MINIPAY_PAYOUT_OPS.md`](docs/MINIPAY_PAYOUT_OPS.md)

## Scripts

```bash
npm run dev          # tsx watch src/server.ts
npm run build        # tsc → dist/
npm start            # node dist/server.js
npm run check:eligibility
npm run check:celo-proof
npm test             # node --test
npm run deploy:registry
npm run deploy:trading-journal
npm run deploy:usage-vault
npm run register:agent
npm run verify:celo-contracts
npm run dune:create-strategy-query
npm run smoke:strategy-lab
```

## Related docs

| File | Description |
| ---- | ----------- |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | Full API |
| [`docs/CELO_ELIGIBILITY.md`](docs/CELO_ELIGIBILITY.md) | Celo eligibility status and command runbook |
| [`LANGCLAW_BLUEPRINT.md`](LANGCLAW_BLUEPRINT.md) | Hackathon blueprint |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | Demo video script |
| [`docs/MINIPAY_PAYOUT_OPS.md`](docs/MINIPAY_PAYOUT_OPS.md) | Project Leader payout and booster checklist |
| [`docs/SMART_CONTRACT_TEAM_NOTES.md`](docs/SMART_CONTRACT_TEAM_NOTES.md) | Vault requirements |
