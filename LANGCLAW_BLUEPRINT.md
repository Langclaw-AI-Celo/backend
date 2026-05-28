# Langclaw Celo Alpha Sentinel Blueprint

Langclaw is positioned for Celo as **Celo Alpha Sentinel**: an AI agent that
turns Celo on-chain, market, and provider evidence into explainable alpha briefs,
watchlist actions, and verifiable on-chain proof records.

## One Sentence

Langclaw is a Celo-first AI intelligence agent that monitors smart-money flow,
liquidity anomalies, protocol momentum, and strategy backtests, then records
evidence-backed decisions on Celo through `LangclawRegistry` and
`LangclawTradingJournal`.

## Track Fit

Primary narrative: **AI Alpha & Data / Celo AI agent proof**.

Why this fits:

- Celo mainnet `42220` is the product chain and default evidence scope.
- Output is an explainable AI alpha brief with confidence, caveats, and source
  gaps, not an autonomous trade claim.
- Celo proof contracts are live and used for decision and strategy records.
- MiniPay is supported through the frontend wallet path and Celo USDT usage
  credits.
- ERC-8004 agent ID `9109` and Self Agent ID `133` connect the agent identity to
  on-chain evidence.

Live-funds trading is intentionally out of scope. Strategy Lab is limited to
backtesting and paper-trade proof records.

## Product Positioning

Frame Langclaw as:

```text
Celo Alpha Sentinel: an AI agent for verifiable Celo alpha, smart-money monitoring, liquidity anomaly detection, and strategy proof.
```

Do not frame it as:

```text
An autonomous trading bot, market maker, arbitrage executor, or custody product.
```

The user asks a Celo alpha question. Langclaw runs provider-backed tools,
normalizes evidence, generates a risk-aware answer, saves strong signals to a
watchlist when requested, and prepares or records an on-chain proof.

## Core Demo Prompts

- `Find smart-money accumulation on Celo`
- `Detect liquidity anomalies on Celo DEX pairs`
- `Rank Celo protocols by TVL and yield momentum`
- `Analyze holder flow and smart-money signals on Celo token 0x471EcE3750Da237f93B8E339c536989b8978a438`

## Agent Workflow

```text
User prompt
  -> Celo chain resolver
  -> Planner
  -> Discovery providers
     -> Surf / Brave / Elfa / GitHub / Tavily / HackQuest when configured
  -> On-chain tools
     -> Surf smart-money research
     -> Dune generated SQL or configured strategy query
     -> DEX Screener Celo pairs
     -> DeFiLlama Celo TVL / yield data
     -> Alchemy / explorer reads when configured
     -> GoPlus skipped honestly on Celo when unsupported
  -> Signal synthesis
  -> Structured report and alpha quality scoring
  -> Evidence packager
  -> Verifier
  -> Final Celo Alpha brief
  -> Optional LangclawRegistry decision proof on Celo
  -> Optional LangclawTradingJournal strategy proof on Celo
```

## Output Shape

Each Celo Intelligence run should surface:

- Signal type, such as `smart-money`, `liquidity-anomaly`, `defi-yield`, or
  `mixed-research`.
- Executive summary and bottom line.
- Evidence cards, tool results, and provider trace.
- Ranked entities or tables only when row-level metrics exist.
- Confidence label and quality score.
- False-positive checks and source gaps.
- Risk note and recommended watch action.
- Usage receipt when the request is billed.
- Evidence URI, decision hash, agent ID, and Celo transaction link when proof
  anchoring is configured.

## Proof Contracts

`LangclawRegistry` records agent decisions:

```solidity
struct AgentDecision {
    uint256 agentId;
    string runId;
    bytes32 decisionHash;
    string evidenceUri;
    string signalType;
    address recorder;
    uint256 createdAt;
}
```

`LangclawTradingJournal` records Strategy Lab runs:

```solidity
struct StrategyRecord {
    uint256 agentId;
    string runId;
    string strategyId;
    string market;
    bytes32 decisionHash;
    bytes32 resultHash;
    string evidenceUri;
    string action;
    int256 pnlBps;
    string status;
    address recorder;
    uint256 createdAt;
}
```

`LangclawUsageVault` accepts Celo USDT deposits, emits deposit events, and lets
the backend-authorized withdrawal authority approve withdrawals.

## UI Scope

Keep the product surface focused on the working app:

- Chat and Celo Intelligence mode.
- Wallet + Telegram gate for research runs.
- Alpha Watchlist for saved signals.
- Usage page for Celo USDT credits and vault interactions.
- Strategy Lab for scan, backtest, equity curve, trades, and paper proof.
- Proof Center for registry decisions and strategy journal records.
- MiniPay detection and Celo mainnet path.

## Scoring Narrative

- **Data source quality:** Celo chain, Surf, Dune, DEX Screener, DeFiLlama,
  explorer reads, and provider trace metadata.
- **AI analysis depth:** signal synthesis, confidence, false-positive checks,
  risk notes, source gaps, and recommended next actions.
- **Technical completeness:** backend workflow, frontend app, wallet auth,
  usage billing, automation, proof contracts, and eligibility scripts.
- **Insight value:** smart-money tracking, liquidity anomaly detection,
  protocol/yield ranking, watchlist, and strategy backtesting.
- **Verifiability:** every anchored decision has a hash, evidence URI, agent ID,
  recorder, timestamp, and Celo transaction.

## MVP Acceptance

- Celo is the default product chain; chain ID resolves to `42220`.
- Celo Intelligence returns signal, evidence, confidence, caveats, risk, and
  action guidance.
- Provider failures are visible as source gaps.
- Research requests reserve and settle usage balance when billing is enabled.
- `LangclawRegistry` returns recorded agent decisions for Proof Center.
- `LangclawTradingJournal` returns strategy records when configured.
- Frontend loads with Celo-first wallet config and MiniPay-aware UX.
- Docs explain analysis-first scope without claiming live trade execution.
