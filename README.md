# Langclaw Backend

Node.js HTTP API (`langclaw-backend`) for **Langclaw Mantle Alpha Sentinel**: Mantle-first on-chain intelligence with Celo and MiniPay support for agent proof, usage billing, and eligibility operations.

**Organization:** [Langclaw-AI-Mantle](https://github.com/Langclaw-AI-Mantle) · **Frontend:** [Langclaw-AI-Mantle/frontend](https://github.com/Langclaw-AI-Mantle/frontend) · **Contracts:** [Langclaw-AI-Mantle/contracts](https://github.com/Langclaw-AI-Mantle/contracts)

## Responsibilities

- **Strategy Lab** - Dune-backed Mantle liquidity momentum backtests, paper trades, and trading journal proofs

- **Mantle Alpha** — `runLangclawWorkflow(topic)` via `POST /api/discover` and `/api/discover/stream`
- **Chat** — `POST /api/chat/stream`, session sync to Supabase
- **Account** — wallet auth, API keys (HMAC), memory, automation, usage ledger
- **Proof** — evidence bundles and Mantle `LangclawRegistry` agent decision records
- **On-chain tools** — Mantle-first Dune, DEX Screener, DeFiLlama, Alchemy, Etherscan-style, and GoPlus providers

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

Full request/response shapes: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

## Langclaw + OpenClaw

OpenClaw runs reasoning steps (`openclaw agent --json`); discovery and provider calls stay in TypeScript.

```text
runLangclawWorkflow(topic)
  → Planner (OpenClaw)
  → Discovery (TS: X/Brave, GitHub, Tavily, HackQuest)
  → Source normalizer (TS)
  → Mantle alpha scorer (OpenClaw)
  → Evidence packager (OpenClaw)
  → Verifier (OpenClaw)
  → Final conclusion (OpenAI Responses → deterministic fallback)
  → Evidence bundle → LangclawRegistry agent decision proof on Mantle
```

Skills: [`openclaw/skills/`](openclaw/skills/) — see [`openclaw/README.md`](openclaw/README.md).

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

Celo/Mantle proof: `MANTLE_CHAIN_*`, `CELO_CHAIN_*`, `{MANTLE,CELO}_AGENT_PRIVATE_KEY`, `{MANTLE,CELO}_AGENT_WALLET`, `{MANTLE,CELO}_ERC8004_AGENT_ID`, `{MANTLE,CELO}_LANGCLAW_REGISTRY_ADDRESS`. Runtime proof/journal transactions prefer the agent key; `{MANTLE,CELO}_PRIVATE_KEY` remains a fallback. Celo transactions use the configured USDT fee-currency adapter when supported. Mantle legacy `LANGCLAW_REGISTRY_ADDRESS` remains supported.

Celo ERC-8004 reputation: set `CELO_ERC8004_REPUTATION_ENABLED=true` plus `CELO_ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY` to submit `giveFeedback(...)` after a Langclaw decision proof anchors. Use a feedback key that is not the agent recorder key.

Core chain data sources: `DUNE_API_KEY`, `DUNE_DEFAULT_QUERY_ID`, `DUNE_STRATEGY_QUERY_ID`, `ALCHEMY_API_KEY`, `ETHERSCAN_API_KEY`, `GOPLUS_*`; DEX Screener and DeFiLlama work without keys for public endpoints. GoPlus is skipped on Celo because the live provider does not support Celo mainnet in this workflow.

Strategy Lab proof: `{MANTLE,CELO}_LANGCLAW_TRADING_JOURNAL_ADDRESS`, `{MANTLE,CELO}_TRADING_JOURNAL_ENABLED`, and optional `{MANTLE,CELO}_TRADING_JOURNAL_DEPLOY_BLOCK`. Mantle legacy `LANGCLAW_TRADING_JOURNAL_ADDRESS` remains supported. Without these, backtests still run and return a `prepared` proof state instead of pretending to be anchored.

Billing: `{MANTLE,CELO}_LANGCLAW_USAGE_VAULT_ADDRESS`. Mantle legacy `LANGCLAW_USAGE_VAULT_ADDRESS` remains supported.

## Supabase

Apply migrations under [`supabase/migrations/`](supabase/migrations/). Clients never write directly; the server uses the service role key.

## Smart contracts

| Contract | Deploy | Env |
| -------- | ------ | --- |
| `LangclawUsageVault` | `npm run deploy:usage-vault -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_DEPLOYER_PRIVATE_KEY`; writes `{MANTLE,CELO}_LANGCLAW_USAGE_VAULT_ADDRESS` |
| `LangclawRegistry` | `npm run deploy:registry -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_DEPLOYER_PRIVATE_KEY`; writes `{MANTLE,CELO}_LANGCLAW_REGISTRY_ADDRESS` |
| `LangclawTradingJournal` | `npm run deploy:trading-journal -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_DEPLOYER_PRIVATE_KEY`; writes `{MANTLE,CELO}_LANGCLAW_TRADING_JOURNAL_ADDRESS`, `{MANTLE,CELO}_TRADING_JOURNAL_ENABLED` |
| ERC-8004 agent identity | `npm run register:agent -- --chain mantle|celo --write-env` | Uses `{MANTLE,CELO}_AGENT_PRIVATE_KEY`; writes `{MANTLE,CELO}_ERC8004_AGENT_ID`, `{MANTLE,CELO}_AGENT_WALLET`, `{MANTLE,CELO}_AGENT_ONCHAIN_TX` |
| Self Agent ID | `npm run register:agent -- --chain celo --self-agent-id --write-env` | Uses `CELO_AGENT_PRIVATE_KEY` plus `CELO_SELF_HUMAN_PROOF` and `CELO_SELF_HUMAN_PROVIDER_DATA` from the Self proof flow; writes `CELO_SELF_AGENT_ID` |

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
