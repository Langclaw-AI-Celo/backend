# Langclaw Mantle Hackathon Blueprint

Langclaw is repositioned for the Mantle Turing Test Hackathon as **Mantle Alpha Sentinel**.

## One Sentence

Langclaw is a verifiable Mantle on-chain intelligence agent that monitors smart money, liquidity anomalies, protocol momentum, and risk signals, then records evidence-backed AI decisions on Mantle.

## Track Fit

Primary track: **AI Alpha & Data / Data & Analytics**.

Why this track:

- Mantle on-chain data is the core input.
- The output is an AI-generated alpha brief, not an autonomous trade claim.
- The product can show insight value through source-backed findings and visual tool output.
- Agent decisions are verifiable through `LangclawRegistry` records on Mantle.

Trading execution is intentionally out of MVP scope until backtesting, live execution, Bybit integration, and on-chain trade records are added.

## Product Positioning

Langclaw should be framed as:

```text
Mantle Alpha Sentinel: an AI agent for verifiable on-chain alpha, smart-money monitoring, and anomaly alerts.
```

It should not be framed as:

```text
An autonomous trading bot.
```

The user asks a Mantle alpha question. Langclaw runs source-backed tools, explains the signal, lists evidence and source gaps, writes a risk-aware watch action, and prepares or records the agent decision proof.

## Core Demo Prompts

- `Find smart-money accumulation on Mantle`
- `Detect liquidity anomalies on Mantle DEX pairs`
- `Rank Mantle protocols by TVL and yield momentum`

## Agent Workflow

```text
User prompt
  -> Mantle chain resolver
  -> Planner
  -> Mantle data tools
     -> Dune Mantle query
     -> DEX Screener Mantle pairs
     -> DeFiLlama Mantle TVL / yields
     -> Alchemy / Etherscan-style wallet and token reads when configured
     -> GoPlus risk checks when configured
  -> Signal synthesis
  -> Evidence packager
  -> Verifier
  -> Final Mantle Alpha brief
  -> LangclawRegistry agent decision record on Mantle
```

## Output Shape

Each Mantle Intelligence run should surface:

- Signal
- Evidence
- Confidence
- Risk note
- Recommended watch/action
- Provider source gaps
- Evidence URI
- Decision hash
- Mantle transaction link when configured
- ERC-8004-compatible agent id when configured

## Proof Contract

`LangclawRegistry` records:

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

The primary event is:

```solidity
event AgentDecisionRecorded(
    uint256 indexed decisionId,
    uint256 indexed agentId,
    address indexed recorder,
    bytes32 decisionHash,
    string runId,
    string evidenceUri,
    string signalType
);
```

## UI Scope

Keep the existing chat layout. Adjust only:

- Suggested prompts
- Mode labels: `Mantle Alpha`, `Mantle Intel`
- Proof copy: `Agent Decision Proof`
- Badges: `Mantle`, `AI Alpha`, `Evidence-backed`, `On-chain recorded`
- Automation copy for smart-money and anomaly alerts

## Scoring Narrative

- **Data source quality:** Mantle chain, Dune Mantle queries, DEX Screener Mantle pairs, DeFiLlama Mantle TVL/yields, wallet/token reads.
- **AI analysis depth:** signal synthesis, confidence, risk note, source gaps, recommended watch/action.
- **Technical completeness:** backend workflow, frontend chat, on-chain tools, automation, proof contract.
- **Insight value:** smart-money tracking, liquidity anomaly detection, protocol momentum ranking.
- **Sustainability:** scheduled monitors and Telegram/in-app alert channels.
- **Verifiability:** every decision has a hash, evidence URI, agent id, recorder, timestamp, and optional Mantle tx.

## MVP Acceptance

- Prompt mentioning Mantle resolves to chain ID `5000`.
- Mantle Intelligence mode returns signal/evidence/confidence/risk/action bullets.
- Provider failures are shown as source gaps.
- `LangclawRegistry` records and returns an agent decision.
- Frontend loads with Mantle-first wallet config and updated labels.
- Docs explain AI Alpha & Data positioning without claiming live trade execution.
