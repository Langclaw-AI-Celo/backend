# Langclaw Backend

Node.js HTTP API for **Langclaw Celo Alpha Sentinel**. The backend powers
Celo-first research, wallet/API authentication, Supabase persistence, usage
billing, automation, strategy backtests, and on-chain proof records.

**Default product chain:** Celo mainnet `42220`
**Default billing asset:** Celo USDT
**Main proof contract:** Celo `LangclawRegistry`

## Responsibilities

- Run Celo Intelligence through `runLangclawWorkflow(topic)`.
- Stream direct chat and research responses through `POST /api/chat/stream`.
- Enforce wallet session or API-key auth for account-scoped routes.
- Require linked Telegram account before chat/research agent runs.
- Reserve, settle, refund, and report internal usage balance.
- Verify Celo USDT deposits into `LangclawUsageVault`.
- Orchestrate providers: Surf, Dune, Brave, Elfa, GitHub, Tavily, HackQuest,
  DEX Screener, DeFiLlama, Alchemy, explorer APIs, CoinGecko, GeckoTerminal,
  GoPlus where supported, and local synthesis.
- Produce deterministic `signals`, `report`, `alphaSignal`, `providerTrace`,
  final answer, usage receipt, and proof metadata.
- Record agent decisions through `LangclawRegistry` when proof env is configured.
- Record Strategy Lab backtests and paper trades through
  `LangclawTradingJournal` when journal env is configured.
- Maintain Celo eligibility and verification scripts.

## Local Setup

```bash
cp .env.example .env
npm install
npm run dev
```

The backend package listens on `http://localhost:3001` unless `PORT` is set.

```bash
curl http://localhost:3001/health
```

Build and run production output:

```bash
npm run build
npm start
```

The frontend proxy defaults to `LANGCLAW_BACKEND_REWRITE_URL=http://127.0.0.1:3002`.
If you are running this backend locally through `npm run dev`, either set the
frontend rewrite to `http://127.0.0.1:3001` or run this backend with `PORT=3002`.

## HTTP Routes

Routes are registered in [`src/server.ts`](src/server.ts).

| Area | Routes |
| --- | --- |
| Health | `GET /health` |
| Wallet auth | `POST /api/wallet/challenge`, `POST /api/wallet/session` |
| Chat | `POST /api/chat/stream`, `POST /api/chat/sessions` |
| Research | `POST /api/discover`, `POST /api/discover/stream` |
| API keys | `POST /api/api-keys` |
| Memory | `POST /api/memory`, `POST /api/memory/settings` |
| Watchlist | `POST /api/watchlist` |
| Usage | `POST /api/usage/balance`, `POST /api/usage/quote`, `POST /api/usage/vault`, `POST /api/usage/deposit/verify`, `POST /api/usage/withdraw/request` |
| Automation | `POST /api/automation/tasks`, `POST /api/automation/runs`, `POST /api/automation/settings`, `POST /api/automation/notifications`, `POST /api/automation/telegram/webhook`, `POST /api/automation/webhooks/:slug` |
| Proof | `POST /api/proofs/decisions`, `POST /api/proofs/readiness` |
| Strategy Lab | `POST /api/strategy/scan-pairs`, `POST /api/strategy/backtest`, `POST /api/strategy/paper-trade`, `POST /api/strategy/runs` |

Full request/response shapes: [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md).

## Research Workflow

```text
request
  -> account auth and Telegram link gate
  -> usage reservation for research mode
  -> Celo chain resolver
  -> OpenClaw planner and reasoning steps when available
  -> TypeScript provider calls and on-chain tools
  -> normalized source cards and tool results
  -> deterministic structured report and alpha quality scoring
  -> final answer synthesis through OpenAI / OpenClaw AI / deterministic fallback
  -> evidence bundle and optional Celo proof anchoring
  -> usage settlement or refund
```

Output contracts are stable and additive:

- `signals.social`, `signals.onchain`, and `signals.combined` are always present.
- `report` is the preferred UI rendering object for ranked entities, tables,
  caveats, recommendations, and narrative sections.
- `alphaSignal` contains quality score, alert eligibility, source coverage, and
  false-positive checks.
- `providerTrace` shows which providers succeeded, failed, skipped, or were out
  of scope.
- `proof` contains storage, chain, and compute metadata.

## Model Behavior

The frontend currently sends the fixed chat model `gpt-5.4-nano`.

Backend defaults are environment-driven:

```bash
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_AGENT_MODEL=gpt-5.2
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_TIMEOUT_SECONDS=90
```

Direct chat honors a supported `body.model`; agent mode passes the requested
model into the Langclaw workflow. If no model is supplied, the backend uses the
configured defaults above, and proof metadata reports requested and used model
fields.

## Environment

Copy [`.env.example`](.env.example). Minimum useful local values:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Persistence and server-side writes |
| `LANGCLAW_API_KEY_PEPPER` | API-key hashing |
| `LANGCLAW_WALLET_SESSION_SECRET` | Wallet session signing |
| `OPENAI_API_KEY` | Direct chat and final answer synthesis |
| `CORS_ORIGIN` | Frontend origin, usually `http://localhost:3000` |

Core Celo values:

```bash
CELO_CHAIN_ENABLED=true
CELO_CHAIN_RPC_URL=https://forno.celo.org
CELO_CHAIN_ID=42220
CELO_CHAIN_EXPLORER_URL=https://celoscan.io
CELO_LANGCLAW_REGISTRY_ADDRESS=
CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS=
CELO_LANGCLAW_USAGE_VAULT_ADDRESS=
CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
CELO_ERC8004_AGENT_ID=
CELO_SELF_AGENT_ID=
```

Provider keys:

```bash
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=
GITHUB_TOKEN=
SURF_ENABLED=false
SURF_API_KEY=
SURF_CLI_FALLBACK_ENABLED=true
ELFA_ENABLED=false
ELFA_API_KEY=
DUNE_API_KEY=
DUNE_STRATEGY_QUERY_ID=
ALCHEMY_API_KEY=
ETHERSCAN_API_KEY=
GOPLUS_API_KEY=
GOPLUS_API_SECRET=
COINGECKO_API_KEY=
```

Provider routing is Celo-first. Surf is the primary smart-money provider when
enabled, Surf CLI can act as a fallback, Dune supplies row-level SQL fallback and
Strategy Lab history, Elfa adds social intelligence when configured, and Nansen
is retained only for explicit Mantle fallback. GoPlus is skipped on Celo in this
workflow when the live provider does not support the chain.

If the live usage vault is token-backed, keep
`{CELO,MANTLE}_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN` set to the ERC-20 deposit
token address. Use the zero address only for native-asset vault deployments.

## Smart-Money Behavior

Smart-money requests preserve user scope before selecting providers:

- `Find smart-money accumulation on Celo` remains chain-level.
- `Find smart-money accumulation for CELO on Celo` may use token-specific
  context.
- Celo chain activity is not treated as Ethereum token activity.
- DEX-only rows are large-flow watchlist entries, not confirmed smart-money
  wallets.
- Confirmed smart money requires wallet labels plus retention or behavior checks.
- Stablecoins and wrapped majors are bucketed separately from non-stable token
  accumulation.
- Final answers hide raw HTTP details, billing internals, CLI flags, and provider
  stack traces from end users.

## Usage Billing

Usage is internal ledger-based billing:

1. User deposits Celo USDT into `LangclawUsageVault`.
2. `POST /api/usage/deposit/verify` verifies the vault `Deposit` event.
3. Backend credits the Supabase usage ledger.
4. Research/chat agent requests reserve balance before work starts.
5. Successful runs settle cost from model/provider usage metadata.
6. Failed runs refund the reservation where possible.
7. `POST /api/usage/withdraw/request` returns withdrawal authorization details
   for available balance.

Celo transactions use the configured USDT fee-currency adapter when supported,
then fall back to native CELO fees if the adapter path is not usable.

## Strategy Lab

Strategy Lab is a proof-backed backtesting module, not live trading.

- `scan-pairs` ranks Celo pairs from Dune historical rows.
- `backtest` runs the Celo Liquidity Momentum Strategy over Dune rows.
- `paper-trade` creates deterministic paper orders from the latest signal.
- `runs` reads `LangclawTradingJournal` records for Proof Center.

Required proof env:

```bash
CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS=
CELO_TRADING_JOURNAL_ENABLED=true
CELO_TRADING_JOURNAL_DEPLOY_BLOCK=
LANGCLAW_STRATEGY_EVIDENCE_BASE_URI=langclaw://strategy
```

Without journal config, Strategy Lab still returns backtest data and an honest
`prepared` proof state.

## Current Celo Verification

| Item | Current value |
| --- | --- |
| Celo chain | Mainnet `42220` |
| Agent wallet | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| `LangclawRegistry` | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| `LangclawTradingJournal` | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| `LangclawUsageVault` | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| Celo USDT deposit token | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| ERC-8004 agent ID | `9109` |
| ERC-8004 registration tx | `0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3` |
| Self Agent ID | `133` |
| Self Agent ID tx | `0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6` |
| Latest decision proof | Decision `#47`, signal `campaign-backend-proof`, agent `9109` |
| Latest decision proof tx | `0xb50e7bd12af0cbca9a6246a80f1976da753d359fbd1553458712b43aa40681b1` |
| Latest decision proof run | `github-backend-433b125-2026-06-08` |
| Latest decision proof evidence | `https://github.com/Langclaw-AI-Celo/backend/commit/433b12562c6472dae9e3ff5a1286596a0420eaeb` |
| Latest Self-linked proof | Decision `#1`, signal `smart-money`, agent `133` |
| Latest Self-linked proof tx | `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

Recheck from this folder:

```bash
npm run check:eligibility
npm run check:celo-proof
```

As of the 2026-06-10 readiness check, `npm run check:celo-proof` reports
`ready`. The latest registry decision is decision `#47`,
`campaign-backend-proof`, for the configured ERC-8004 proof agent `9109`,
while Self Agent ID `133` remains available for linked-proof flows. RPC
connectivity, gas balance, and registry reads all passed.

## Smart Contracts

| Contract | Deploy script | Writes env |
| --- | --- | --- |
| `LangclawUsageVault` | `npm run deploy:usage-vault -- --chain mantle\|celo` | `{MANTLE,CELO}_LANGCLAW_USAGE_VAULT_ADDRESS` |
| `LangclawRegistry` | `npm run deploy:registry -- --chain mantle\|celo --write-env` | `{MANTLE,CELO}_LANGCLAW_REGISTRY_ADDRESS` |
| `LangclawTradingJournal` | `npm run deploy:trading-journal -- --chain mantle\|celo` | `{MANTLE,CELO}_LANGCLAW_TRADING_JOURNAL_ADDRESS`, `{MANTLE,CELO}_TRADING_JOURNAL_ENABLED` |
| ERC-8004 identity | `npm run register:agent -- --chain mantle\|celo --write-env` | `{MANTLE,CELO}_ERC8004_AGENT_ID`, agent wallet, registration tx |
| Self Agent ID | Official Self linked flow or `npm run register:agent -- --chain celo --self-agent-id --write-env` | `CELO_SELF_AGENT_ID`, Self registration tx |

Related contract docs:

- Registry source: [`../contracts/src/LangclawRegistry.sol`](../contracts/src/LangclawRegistry.sol)
- Vault spec: [`docs/SMART_CONTRACT_TEAM_NOTES.md`](docs/SMART_CONTRACT_TEAM_NOTES.md)
- Eligibility runbook: [`docs/CELO_ELIGIBILITY.md`](docs/CELO_ELIGIBILITY.md)
- MiniPay payout checklist: [`docs/MINIPAY_PAYOUT_OPS.md`](docs/MINIPAY_PAYOUT_OPS.md)

## Scripts

```bash
npm run dev
npm run build
npm start
npm run typecheck
npm test
npm run check:eligibility
npm run check:celo-proof
npm run verify:celo-contracts
npm run deploy:registry
npm run deploy:trading-journal
npm run deploy:usage-vault
npm run register:agent
npm run dune:create-strategy-query
npm run smoke:strategy-lab
```

GitHub profile checks run when the `.github` repository is available beside
this checkout. Set `LANGCLAW_ORG_PROFILE_ROOT` when it lives elsewhere. The
suite skips only those cross-repository checks when the profile repository is
absent.

## Related Docs

| File | Description |
| --- | --- |
| [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md) | Full backend API reference |
| [`docs/CELO_ELIGIBILITY.md`](docs/CELO_ELIGIBILITY.md) | Celo eligibility status and command runbook |
| [`LANGCLAW_BLUEPRINT.md`](LANGCLAW_BLUEPRINT.md) | Product, demo, and proof blueprint |
| [`docs/HACKATHON_SUBMISSION.md`](docs/HACKATHON_SUBMISSION.md) | Submission narrative |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | Demo video script |
| [`docs/MINIPAY_PAYOUT_OPS.md`](docs/MINIPAY_PAYOUT_OPS.md) | Project Leader payout and booster checklist |
| [`docs/SMART_CONTRACT_TEAM_NOTES.md`](docs/SMART_CONTRACT_TEAM_NOTES.md) | Contract responsibilities and env contract |
