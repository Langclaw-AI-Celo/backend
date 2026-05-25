# Langclaw Celo Alpha Sentinel

This document describes the Celo submission narrative. For the live eligibility checklist, see [`CELO_ELIGIBILITY.md`](./CELO_ELIGIBILITY.md).

## Track

Langclaw targets Proof of Ship through the AI Agents Prize Pool, with MiniPay Mini App as the supporting path. Its product narrative is AI Alpha & Data: Celo intelligence, explainable signals, watchlists, and on-chain agent proof. Strategy Lab supports the demo with backtesting and paper-trade proof.

Langclaw is not a live-funds trading executor. It produces source-backed Celo intelligence, watchlist recommendations, Dune-backed strategy backtests, paper-trading orders, and verifiable on-chain proof.

## One-Liner

Langclaw is a Celo-first AI intelligence and strategy agent that analyzes smart-money flow, liquidity anomalies, protocol momentum, and DEX pair history, then records each agent decision and paper-trading outcome on Celo through proof contracts linked to an ERC-8004 identity.

## Why It Fits

| Requirement | Langclaw coverage |
| --- | --- |
| Celo on-chain data as a core source | Celo chain `42220`, DEX Screener Celo pairs, DeFiLlama Celo protocol and yield data, optional Dune, Alchemy, and explorer providers |
| AI analysis depth | Planner, source normalization, signal synthesis, risk notes, evidence packaging, and final answer generation |
| Technical completeness | Backend API, frontend integration, Celo wallet flow, proof registry, ERC-8004 agent identity, and provider-gap reporting |
| Sustainability | Modular provider layer, optional usage vault, API-key based backend, automation, and notification hooks |
| Insight value | Smart-money summaries, liquidity risk checks, protocol and yield watchlists, Alpha Watchlist signals, and source-backed confidence notes |
| Strategy alpha | Celo Liquidity Momentum Strategy with Dune historical rows, equity curve, trade table, win rate, drawdown, deterministic paper orders, and journal proof status |

## User Problem

Celo builders, analysts, and MiniPay-facing teams need a fast way to screen Celo token and protocol signals before they add a watchlist item or share a call. The current workflow often splits on-chain rows, social context, risk checks, and proof records across separate tools. Langclaw turns that workflow into one Celo-focused agent run with source evidence, confidence notes, and an on-chain decision record.

## Current Celo Proof Layer

| Item | Value |
| --- | --- |
| Celo chain ID | `42220` |
| LangclawRegistry | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| LangclawTradingJournal | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| LangclawUsageVault | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Langclaw Celo ERC-8004 agent ID | `9109` |
| Agent owner / recorder | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| Latest recorded decision | `#0` smart-money, tx `0x0e48bd059c782dd59a7834279388e0b2d305f9aba758c8fdb412e8eb55d2dc7d` |

## Submission Readiness

| Area | Status | Evidence |
| --- | --- | --- |
| Celo mainnet contracts | Ready | Registry, Trading Journal, and Usage Vault have Celo bytecode and verified explorer source |
| AI agent proof | Ready for ERC-8004, pending Self Agent ID | ERC-8004 agent `9109`, registration tx `0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3`, latest decision proof `#0` |
| MiniPay support | Code ready, capture pending | MiniPay detection, Celo mainnet lock, and USDT stablecoin credits are implemented. Mobile screenshots still need to be captured |
| Talent App | Manual follow-up | Builder profile, project page, campaign enrollment, and leaderboard evidence must be confirmed in Talent App |
| Reward claim | Manual follow-up | Project Leader must claim through MiniPay or the program fallback before the reward deadline |

## Safety Policy

- Langclaw does not execute live-funds trades.
- Strategy Lab records backtests and paper trades only.
- User wallet actions stay explicit.
- Agent private keys stay in backend environment variables.
- Signal output keeps false-positive checks visible before any recommendation.

## Signal Quality

Langclaw does not treat every large flow as alpha. It scores signal quality from source depth, provider status, row-level evidence, and missing checks.

| Confidence | Meaning | Example evidence |
| --- | --- | --- |
| High | Multiple sources agree and wallet evidence includes labels plus follow-up checks. | Row-level wallet flow, wallet label, retention check, sell-pressure check, source URL, and second-source validation |
| Medium | Row-level on-chain data exists, but identity or follow-up evidence is incomplete. | DEX accumulation rows, CEX withdrawal rows, token amount, USD value, trade count, window, provider status, and source URL |
| Low | The run has narrative context, weak provider coverage, or fallback synthesis. | No wallet-flow rows, partial social signal, failed provider route, or unavailable label and retention checks |

## False Positive Handling

- DEX-only rows are large-flow watchlist entries, not confirmed smart-money wallets.
- Confirmed smart money requires wallet labels plus retention or sell-pressure checks.
- CEX deposits are possible sell-pressure signals, not accumulation candidates.
- External token activity stays low-confidence context when it is not native to the requested chain.
- Empty provider rows do not create fake tables.

## Strategy Lab

Strategy Lab adds a paper-trading proof path without live-funds risk.

1. User chooses a Celo pair or scans Celo pairs.
2. Backend fetches historical rows from Dune using `DUNE_STRATEGY_QUERY_ID` or a submitted query ID.
3. The Celo Liquidity Momentum Strategy backtests price momentum, volume and liquidity strength, minimum liquidity, optional whale flow, stop loss, take profit, and max holding time.
4. UI renders equity curve, trades, win rate, max drawdown, PnL, latest signal, and evidence metadata.
5. User opens a paper trade from the latest signal.
6. Backend computes deterministic `decisionHash` and `resultHash`, then records the run in `LangclawTradingJournal` when Celo journal env is configured.

## Demo Prompts

Use these prompts in Celo Intelligence mode:

```text
Analyze CELO and stablecoin flow on Celo
```

Expected result: Celo holder-flow summary, confidence note, risk note, and decision proof state.

```text
Detect liquidity anomaly on Celo DEX pairs
```

Expected result: Celo DEX pair evidence, liquidity/risk signal, no unrelated chain pair leakage, and decision proof state.

```text
Rank Celo protocols by TVL and yield momentum
```

Expected result: DeFiLlama-backed protocol and yield context for a Celo ecosystem dashboard narrative.

Use Strategy Lab at `/strategy`:

```text
Select a Celo DEX pair, provide a Dune query id if it is not set in backend env, and run backtest.
```

Expected result: strategy metrics, equity curve, trade log, latest AI signal, Dune evidence details, and an anchored or prepared `LangclawTradingJournal` proof.

## What To Say In The Video

1. Langclaw is an AI Alpha & Data agent for Celo, with Strategy Lab for verifiable backtesting and paper trading.
2. It uses Celo on-chain and provider data as the evidence base.
3. It separates usable evidence from provider gaps instead of hiding missing sources.
4. It records each AI decision hash on Celo through `LangclawRegistry`.
5. The registry record is linked to ERC-8004 agent ID `9109`, giving the agent an on-chain performance trail.
6. Strong signals can be saved to Alpha Watchlist for follow-up, while Proof Center shows registry history and Strategy Proofs.

## Local Verification

```bash
npm run check:celo-proof
npm run typecheck
npm test
```

## Caveat

Langclaw does not sign, send, swap, buy, sell, or execute live-funds trades in the current build. Strategy Lab is scoped to backtesting and paper trading.

Usage billing is ledger-based: user USDT deposits on Celo are credited after vault deposit verification, then research requests reserve and settle usage balance internally.
