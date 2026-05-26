# Smart Contract Team Notes

Langclaw uses Celo contracts by default for prepaid usage balance and agent decision proof. Mantle env values remain optional for explicit Mantle analysis.

## Scope

- `LangclawUsageVault`: accepts user USDT deposits on Celo, emits deposit events, and lets the backend-authorized signer approve withdrawals.
- `LangclawRegistry`: records verifiable agent decisions on the selected product chain with `agentId`, `runId`, `decisionHash`, `evidenceUri`, `signalType`, recorder, and timestamp.
- `LangclawTradingJournal`: records verifiable strategy backtests and paper trades on the selected product chain with `agentId`, `runId`, `strategyId`, market, action, PnL bps, status, evidence URI, decision hash, and result hash.
- OpenAI is the inference provider. User USDT deposits are app credits, not model-provider account funding.

## Required Environment

```bash
MANTLE_CHAIN_ENABLED=false
MANTLE_CHAIN_RPC_URL=https://rpc.mantle.xyz
MANTLE_CHAIN_ID=5000
MANTLE_CHAIN_EXPLORER_URL=https://explorer.mantle.xyz
MANTLE_PRIVATE_KEY=
MANTLE_DEPLOYER_PRIVATE_KEY=
MANTLE_AGENT_WALLET=
MANTLE_AGENT_PRIVATE_KEY=
MANTLE_AGENT_ONCHAIN_TX=
MANTLE_LANGCLAW_USAGE_VAULT_ADDRESS=0x7e93Ef361e7b54297cF963977bA829E47E59e8E1
MANTLE_LANGCLAW_REGISTRY_ADDRESS=0xe69755e4249c4978c39fbe847ca9674ce7af3505
MANTLE_LANGCLAW_TRADING_JOURNAL_ADDRESS=0xe96e9b76af8c8f32bfa2235d647186826d92fb7d
MANTLE_TRADING_JOURNAL_ENABLED=true
MANTLE_TRADING_JOURNAL_DEPLOY_BLOCK=95529438
MANTLE_ERC8004_AGENT_ID=94
MANTLE_ERC8004_IDENTITY_REGISTRY_ADDRESS=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
MANTLE_ERC8004_REPUTATION_ENABLED=false
MANTLE_ERC8004_REPUTATION_REGISTRY_ADDRESS=
MANTLE_ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY=
CELO_CHAIN_ENABLED=true
CELO_CHAIN_RPC_URL=https://forno.celo.org
CELO_CHAIN_ID=42220
CELO_CHAIN_EXPLORER_URL=https://celoscan.io
CELO_PRIVATE_KEY=
CELO_DEPLOYER_PRIVATE_KEY=
CELO_AGENT_WALLET=
CELO_AGENT_PRIVATE_KEY=
CELO_AGENT_ONCHAIN_TX=
CELO_LANGCLAW_USAGE_VAULT_ADDRESS=0x837a2948586de4e7638c742f99e520ffc049bcf7
CELO_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
CELO_LANGCLAW_REGISTRY_ADDRESS=0xe69755e4249c4978c39fbe847ca9674ce7af3505
CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS=0x69984c20176704685236fd633192d7de1c13a5ec
CELO_TRADING_JOURNAL_ENABLED=true
CELO_TRADING_JOURNAL_DEPLOY_BLOCK=67457224
CELO_ERC8004_AGENT_ID=9109
CELO_ERC8004_IDENTITY_REGISTRY_ADDRESS=0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
CELO_ERC8004_REPUTATION_ENABLED=false
CELO_ERC8004_REPUTATION_REGISTRY_ADDRESS=0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
CELO_ERC8004_REPUTATION_FEEDBACK_PRIVATE_KEY=
CELO_SELF_AGENT_ID=
CELO_SELF_AGENT_REGISTRY_ADDRESS=0xaC3DF9ABf80d0F5c020C06B04Cced27763355944
CELO_SELF_AGENT_ONCHAIN_TX=
CELO_SELF_HUMAN_PROOF_PROVIDER_ADDRESS=0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d
CELO_SELF_HUMAN_PROOF=
CELO_SELF_HUMAN_PROVIDER_DATA=
CELO_SELF_REPUTATION_REGISTRY_ADDRESS=0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4
```

## Usage Vault Flow

1. User deposits USDT on Celo into `LangclawUsageVault`; Celo transactions use USDT fee abstraction where supported.
2. Backend verifies the `Deposit` event through the selected chain RPC.
3. Backend credits the internal Supabase usage ledger.
4. Research/chat usage is deducted from the internal balance.
5. Withdrawals require backend authorization through `authorizeWithdrawal`.

## Registry Flow

1. Langclaw builds a canonical evidence bundle from source cards, tool results, agent trace, and final answer.
2. Backend computes `decisionHash = keccak256(canonicalBundle)`.
3. Backend prepares `evidenceUri` using `LANGCLAW_EVIDENCE_BASE_URI`.
4. If `{MANTLE,CELO}_CHAIN_ENABLED=true`, backend submits `recordAgentDecision(...)` to that chain's `LangclawRegistry`.
5. If `{MANTLE,CELO}_ERC8004_REPUTATION_ENABLED=true`, backend submits ERC-8004 `giveFeedback(...)` from the configured feedback key after the decision proof anchors.

## Trading Journal Flow

1. Strategy Lab fetches Dune historical rows and runs the selected chain's Liquidity Momentum Strategy.
2. Backend computes deterministic strategy `decisionHash` and `resultHash`.
3. Backend prepares an evidence URI using `LANGCLAW_STRATEGY_EVIDENCE_BASE_URI`.
4. If `{MANTLE,CELO}_TRADING_JOURNAL_ENABLED=true`, backend submits `recordStrategyRun(...)` to the selected chain's `LangclawTradingJournal`.
5. If the journal is not configured, the API returns a `prepared` proof state; if submission or receipt lookup fails, it returns `failed` with the error message.

Keep vault and registry responsibilities separate:

- Vault is billing only.
- Registry is agent decision proof only.
- Trading journal is strategy backtest and paper-trade proof only.

Eligibility tooling:

- Run `npm run check:eligibility` from `backend/` to compare the local env against live Celo chain and explorer evidence.
- Run `npm run verify:celo-contracts` to attempt Blockscout verification or export fallback Standard JSON bundles for manual explorer upload.
