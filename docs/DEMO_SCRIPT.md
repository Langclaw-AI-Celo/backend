# Langclaw Mantle Alpha Sentinel Demo Script

Use this script for a 3 to 4 minute Mantle Turing Test Hackathon video.

## 0:00 to 0:20

Say:

```text
Langclaw is a Mantle Alpha Sentinel: an AI agent that monitors Mantle on-chain data, finds smart-money and liquidity anomalies, backtests Mantle pair strategies, and records source-backed agent decisions on-chain.
```

Show:

- Langclaw chat
- Mantle / AI Alpha / Evidence-backed badges
- Mantle wallet connection

## 0:20 to 0:50

Say:

```text
I enter a Mantle alpha prompt. Langclaw routes it through planner, source, trend, evidence, verifier, and final conclusion agents while preserving the trace for judges.
```

Show:

- Suggested prompt: `Analyze holder flow and smart-money signals on Mantle token 0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34`
- Second prompt: `Detect liquidity anomaly on Mantle pair 0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5`
- Mantle Alpha or Mantle Intelligence mode
- Agent workflow panel

## 0:50 to 1:30

Say:

```text
The tool layer prioritizes Mantle data: Dune Mantle queries, DEX Screener Mantle pairs, DeFiLlama TVL and yields, wallet flow reads, and security/risk checks when configured. Provider failures are shown as source gaps instead of hidden.
```

Show:

- Mantle chain selected
- Tool results with provider, status, source URL, and fetched records
- Source gap messages if an optional provider is not configured

## 1:30 to 2:05

Say:

```text
The answer is analysis-only, not a trading execution claim. It gives the signal, evidence, confidence, risk note, and recommended watch action.
```

Show:

- Final Mantle Alpha brief
- Signal / Evidence / Confidence / Risk note / Recommended watch action bullets
- Visual summary cards for source quality, whale flow, liquidity, TVL/yield, and confidence/risk
- Source-backed records
- Add the strongest result to Alpha Watchlist

## 2:05 to 2:45

Say:

```text
For the AI Trading & Strategy track, Strategy Lab uses Dune historical data to backtest a Mantle Liquidity Momentum Strategy. It shows equity curve, trade log, win rate, drawdown, latest signal, and then opens a paper trade without touching live funds.
```

Show:

- Strategy Lab at `/strategy`
- Mantle pair selector and Dune query id field
- Run Backtest
- Equity curve and trade table
- Open Paper Trade
- Paper trade proof panel with `prepared`, `anchored`, or `failed` status

## 2:45 to 3:20

Say:

```text
For transparency, Langclaw builds an evidence bundle and records the agent decision hash through LangclawRegistry on Mantle. The record includes the ERC-8004-compatible agent id, run id, signal type, evidence URI, recorder, and timestamp.
```

Show:

- Agent Decision Proof panel
- Proof Center at `/proofs`
- `decisionHash`
- `agentId` = `94`
- `signalType` = `smart-money` or `liquidity-anomaly`
- Mantle transaction link when configured
- Strategy Proofs section for `LangclawTradingJournal`

Real proof examples:

- `decisionId 1`, smart-money tx `0x39caaca5fe3a6792c427740342116f309ac02ee0a846c7dbe54f12c86a39a177`
- `decisionId 2`, liquidity-anomaly tx `0x9956a7574f6144ce831deac3275305939d65503366bc11bd922bc4783eeb5faf`

## 3:20 to 3:45

Say:

```text
Langclaw fits AI Alpha & Data and AI Trading & Strategy: Mantle on-chain data as the core source, AI analysis depth, useful visual evidence, backtesting and paper-trade verifiability, and on-chain agent proof.
```

Show:

- Repo
- Demo URL
- Submission summary
