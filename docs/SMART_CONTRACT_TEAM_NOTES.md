# Smart Contract Team Notes

Langclaw uses Celo contracts by default for prepaid usage balance, agent
decision proof, and Strategy Lab proof. Mantle env values remain optional for
explicit Mantle analysis and legacy compatibility.

## Contract Scope

| Contract | Responsibility | Not Responsible For |
| --- | --- | --- |
| `LangclawUsageVault` | Accept Celo USDT deposits, emit deposit events, hold vault funds, and let a backend-authorized signer approve withdrawals | AI decision proof, trading execution, model-provider billing |
| `LangclawRegistry` | Record agent decisions with `agentId`, `runId`, `decisionHash`, `evidenceUri`, `signalType`, recorder, and timestamp | Usage deposits, withdrawals, strategy PnL |
| `LangclawTradingJournal` | Record Strategy Lab backtests and paper trades with strategy metadata, deterministic hashes, PnL bps, status, recorder, and timestamp | Live trading, swaps, custody, usage balance |

OpenAI is the inference provider. User USDT deposits are app usage credits, not
OpenAI account funding.

## Live Celo Deployments

| Contract | Address |
| --- | --- |
| `LangclawRegistry` | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| `LangclawTradingJournal` | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| `LangclawUsageVault` | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| Celo USDT deposit token | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |

Agent identity:

| Item | Value |
| --- | --- |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Celo ERC-8004 agent ID | `9109` |
| Self Agent ID | `133` |
| Agent wallet / recorder | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |

## Required Environment

```bash
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
CELO_SELF_AGENT_ID=133
CELO_SELF_AGENT_REGISTRY_ADDRESS=0xaC3DF9ABf80d0F5c020C06B04Cced27763355944
CELO_SELF_AGENT_ONCHAIN_TX=0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6
CELO_SELF_HUMAN_PROOF_PROVIDER_ADDRESS=0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d
CELO_SELF_HUMAN_PROOF=
CELO_SELF_HUMAN_PROVIDER_DATA=
CELO_SELF_REPUTATION_REGISTRY_ADDRESS=0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4
LANGCLAW_EVIDENCE_BASE_URI=langclaw://evidence
LANGCLAW_STRATEGY_EVIDENCE_BASE_URI=langclaw://strategy
```

Mantle remains optional:

```bash
MANTLE_CHAIN_ENABLED=false
MANTLE_CHAIN_RPC_URL=https://rpc.mantle.xyz
MANTLE_CHAIN_ID=5000
MANTLE_CHAIN_EXPLORER_URL=https://explorer.mantle.xyz
MANTLE_LANGCLAW_USAGE_VAULT_ADDRESS=
MANTLE_LANGCLAW_REGISTRY_ADDRESS=
MANTLE_LANGCLAW_TRADING_JOURNAL_ADDRESS=
MANTLE_TRADING_JOURNAL_ENABLED=false
MANTLE_ERC8004_AGENT_ID=
```

## Usage Vault Flow

1. User deposits USDT on Celo into `LangclawUsageVault` through
   `depositTokenAmount(bytes32 depositReference, uint256 amount)`.
2. Frontend waits for the transaction receipt.
3. Backend verifies the `Deposit` event through the selected chain RPC.
4. Backend credits the internal Supabase usage ledger.
5. Research/chat usage is deducted from the internal balance.
6. Withdrawal requests require backend authorization through
   `authorizeWithdrawal(address payer, uint256 amount, bytes32 withdrawalId)`.
7. User withdraws authorized balance through `withdraw(uint256 amount)`.

The vault can be paused by the owner and prevents ownership renounce.

## Registry Flow

1. Langclaw builds a canonical evidence bundle from source cards, tool results,
   agent trace, report, and final answer.
2. Backend computes `decisionHash = keccak256(canonicalBundle)`.
3. Backend prepares `evidenceUri` using `LANGCLAW_EVIDENCE_BASE_URI`.
4. If `CELO_CHAIN_ENABLED=true`, backend submits `recordAgentDecision(...)`.
5. Proof Center reads `getDecision(decisionId)` and displays transaction
   metadata.
6. If `CELO_ERC8004_REPUTATION_ENABLED=true`, backend can submit ERC-8004
   feedback after the decision proof anchors, using a feedback key separate from
   the agent recorder key.

## Trading Journal Flow

1. Strategy Lab fetches Dune historical rows.
2. Backend runs the selected chain's Liquidity Momentum Strategy.
3. Backend computes deterministic strategy `decisionHash` and `resultHash`.
4. Backend prepares `evidenceUri` using `LANGCLAW_STRATEGY_EVIDENCE_BASE_URI`.
5. If `CELO_TRADING_JOURNAL_ENABLED=true`, backend submits
   `recordStrategyRun(...)`.
6. If the journal is not configured, the API returns a `prepared` proof state.
7. If submission or receipt lookup fails, the API returns `failed` with an error
   message.

## Operational Commands

```bash
cd backend
npm run check:eligibility
npm run check:celo-proof
npm run verify:celo-contracts
```

```bash
cd contracts
forge build
forge test
```

## Separation Rules

- Vault is billing only.
- Registry is agent decision proof only.
- Trading journal is strategy backtest and paper-trade proof only.
- Neither registry nor journal executes trades.
- Neither usage vault nor usage ledger should be described as investment
  custody.
