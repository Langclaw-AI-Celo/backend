# Langclaw Celo Alpha Sentinel Submission

This document is the Celo-facing submission narrative. For live eligibility
checks and command runbooks, see [`CELO_ELIGIBILITY.md`](./CELO_ELIGIBILITY.md).

## Track

Langclaw targets Celo AI agent and Proof of Ship style evaluation with MiniPay
Mini App support as the user distribution path. The product narrative is
**AI Alpha & Data**: Celo intelligence, explainable signals, watchlists,
strategy backtesting, and on-chain agent proof.

Langclaw is not a live-funds trading executor. It produces source-backed Celo
intelligence, watchlist recommendations, Dune-backed strategy backtests,
paper-trading orders, and verifiable on-chain proof.

## One-Liner

Langclaw is a Celo-first AI intelligence and strategy agent that analyzes
smart-money flow, liquidity anomalies, protocol momentum, and DEX pair history,
then records agent decisions and paper-trading outcomes on Celo through proof
contracts linked to ERC-8004 and Self Agent ID records.

## Why It Fits

| Requirement | Langclaw coverage |
| --- | --- |
| Celo on-chain data as a core source | Celo chain `42220`, DEX Screener Celo pairs, DeFiLlama Celo protocol/yield data, optional Dune, Alchemy, and explorer providers |
| AI analysis depth | Planner, source normalization, signal synthesis, final answer generation, false-positive checks, and risk notes |
| Technical completeness | Backend API, frontend app, Celo wallet flow, MiniPay detection, usage vault, proof registry, strategy journal, ERC-8004 identity, and provider-gap reporting |
| Sustainability | Modular provider layer, Supabase persistence, API keys, usage billing, automation, and notification hooks |
| Insight value | Smart-money summaries, liquidity anomaly checks, protocol/yield ranking, Alpha Watchlist, and source-backed confidence notes |
| Strategy proof | Celo Liquidity Momentum Strategy with Dune historical rows, equity curve, trade table, win rate, drawdown, deterministic paper orders, and journal proof status |

## User Problem

Celo builders, analysts, and MiniPay-facing teams need a fast way to screen Celo
token and protocol signals before adding a watchlist item or sharing a call. The
current workflow often splits on-chain rows, social context, risk checks, and
proof records across separate tools. Langclaw turns that workflow into one
Celo-focused agent run with source evidence, confidence notes, and an on-chain
decision record.

## Product Flow

1. User connects a Celo wallet. Inside MiniPay, the frontend detects MiniPay and
   keeps the user on Celo mainnet.
2. User links Telegram from automation notification settings.
3. User asks a Celo alpha question in chat or research mode.
4. Backend reserves internal usage balance for agent research.
5. Langclaw runs provider-backed Celo intelligence tools.
6. Backend returns `signals`, `report`, `alphaSignal`, `providerTrace`, final
   answer, usage receipt, and proof metadata.
7. User can save strong output to Alpha Watchlist.
8. Proof Center reads Celo `LangclawRegistry` and `LangclawTradingJournal`
   records.
9. Strategy Lab can scan pairs, run a Dune-backed backtest, and open a paper
   trade proof without live-funds execution.

## Current Celo Proof Layer

| Item | Value |
| --- | --- |
| Celo chain ID | `42220` |
| `LangclawRegistry` | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| `LangclawTradingJournal` | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| `LangclawUsageVault` | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| Celo USDT deposit token | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Langclaw Celo ERC-8004 agent ID | `9109` |
| Langclaw Self Agent ID | `133` |
| Agent owner / recorder | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| Latest recorded decision | `#1` smart-money, agent `133`, tx `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

## Submission Readiness

| Area | Status | Evidence |
| --- | --- | --- |
| Celo mainnet contracts | Ready | Registry, Trading Journal, and USDT Usage Vault have Celo bytecode and verified explorer source |
| AI agent identity | Ready | ERC-8004 agent `9109`, Self Agent ID `133`, and verified registration transactions |
| On-chain agent proof | Ready | Latest registry decision `#1` is recorded on Celo for agent `133` |
| MiniPay support | Code ready, media capture pending | MiniPay detection, Celo mainnet path, and USDT usage credits exist in frontend |
| Talent/App campaign ops | Manual follow-up | Project page, campaign enrollment, and leaderboard evidence must be confirmed outside the repo |
| Reward claim | Manual follow-up | Project Leader must claim through MiniPay or the program fallback before the reward deadline |

## Safety Policy

- Langclaw does not execute live-funds trades.
- Strategy Lab records backtests and paper trades only.
- User wallet actions stay explicit.
- Agent private keys stay in backend environment variables.
- Usage deposits are app credits, not investment deposits or model-provider
  account funding.
- Final answers must keep false-positive checks, source gaps, and caveats
  visible.

## Signal Quality

Langclaw does not treat every large flow as alpha. It scores signal quality from
source depth, provider status, row-level evidence, proof state, and missing
checks.

| Confidence | Meaning | Example evidence |
| --- | --- | --- |
| High | Multiple sources agree and wallet evidence includes labels plus follow-up checks. | Wallet flow rows, label or behavior evidence, retention check, source URL, and second-source validation |
| Medium | Row-level on-chain data exists, but identity or follow-up evidence is incomplete. | DEX accumulation rows, CEX withdrawal rows, token amount, USD value, trade count, window, provider status |
| Low | Narrative context exists, but provider coverage is weak or fallback synthesis was used. | No row-level flow, partial social signal, unavailable provider, or missing labels |

## False Positive Handling

- DEX-only rows are large-flow watchlist entries, not confirmed smart-money
  wallets.
- Confirmed smart money requires wallet labels plus retention or sell-pressure
  checks.
- CEX deposits are possible sell-pressure signals, not accumulation candidates.
- External token activity remains low-confidence context when it is not native to
  the requested chain.
- Empty provider rows do not create fake tables.

## Strategy Lab

Strategy Lab adds a paper-trading proof path without live-funds risk.

1. User chooses a Celo pair or scans Celo pairs.
2. Backend fetches historical rows from Dune using `DUNE_STRATEGY_QUERY_ID` or a
   submitted query ID.
3. Celo Liquidity Momentum Strategy backtests price momentum, volume and
   liquidity strength, minimum liquidity, optional whale flow, stop loss, take
   profit, and max holding time.
4. UI renders equity curve, trades, win rate, max drawdown, PnL, latest signal,
   and evidence metadata.
5. User opens a paper trade from the latest signal.
6. Backend computes deterministic `decisionHash` and `resultHash`, then records
   the run in `LangclawTradingJournal` when Celo journal env is configured.

## Demo Prompts

Use these prompts in Celo Intelligence mode:

```text
Find smart-money accumulation on Celo
```

Expected result: Celo smart-money summary, evidence quality, risk note, source
gaps, and decision proof state.

```text
Detect liquidity anomalies on Celo DEX pairs
```

Expected result: Celo DEX pair evidence, liquidity/risk signal, anomaly table
when row-level data exists, and no unrelated chain leakage.

```text
Rank Celo protocols by TVL and yield momentum
```

Expected result: DeFiLlama-backed protocol and yield context for a Celo
ecosystem dashboard narrative.

Use Strategy Lab at `/strategy`:

```text
Scan Celo pairs, select the best pair, run a Dune-backed backtest, and open a paper trade proof.
```

Expected result: strategy metrics, equity curve, trade log, latest AI signal,
Dune evidence details, and an anchored or prepared `LangclawTradingJournal`
proof.

## What To Say In The Video

1. Langclaw is an AI Alpha & Data agent for Celo, with Strategy Lab for
   verifiable backtesting and paper trading.
2. It uses Celo on-chain and provider data as the evidence base.
3. It separates usable evidence from provider gaps instead of hiding missing
   sources.
4. It records each AI decision hash on Celo through `LangclawRegistry`.
5. The latest registry record is linked to Self Agent ID `133`, with ERC-8004
   agent ID `9109` kept as the base identity record.
6. Strong signals can be saved to Alpha Watchlist, while Proof Center shows
   registry history and Strategy Proofs.

## Local Verification

```bash
npm run check:celo-proof
npm run check:eligibility
npm run typecheck
npm test
```

## Caveat

Langclaw does not sign, send, swap, buy, sell, or execute live-funds trades in
the current build. Strategy Lab is scoped to backtesting and paper trading.

Usage billing is ledger-based: user USDT deposits on Celo are credited after
vault deposit verification, then research requests reserve and settle usage
balance internally.
