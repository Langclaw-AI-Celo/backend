# Langclaw API Reference

Backend base URL defaults to `http://localhost:3001`.

## Health

`GET /health`

Returns `{ "ok": true, "service": "langclaw-backend" }`.

## Chat

`POST /api/chat/stream`

Streams newline-delimited JSON. Direct chat uses OpenAI Responses API. Research mode runs the Langclaw workflow and can record selected-chain decision proof. The streamed `result.payload` now includes a stable `signals` object with `social`, `onchain`, and `combined` summaries, plus an additive `report` object for native report rendering.

Request:

```json
{
  "message": "Find smart-money accumulation on Mantle",
  "toolMode": "research",
  "model": "gpt-5-mini",
  "wallet": {
    "address": "0x...",
    "sessionToken": "..."
  }
}
```

Important stream event types:

- `direct_delta`, `direct`: direct OpenAI chat.
- `progress`, `result`: research workflow.
- `tool_plan`, `tool_call`, `tool_result`, `tool_final`: Mantle intelligence tools.
- `error`: request failure.

For `tool_result` and `tool_final.payload.tools`, each tool result can now include additive metadata:

- `attemptedProviders`: providers tried for that logical tool step
- `fallbackReason`: why execution moved to a fallback provider
- `scope`: `mantle-premium`, `legacy-fallback`, `legacy-default`, or `out-of-scope`

## Research

`POST /api/discover`

Runs the Mantle Alpha workflow and returns a single JSON payload.

`POST /api/discover/stream`

Streams workflow progress before the final payload.

The response includes source cards, provider trace, structured `signals`, an additive `report`, final answer, usage receipt, and proof metadata:

```json
{
  "topic": "Rank Mantle protocols by TVL and yield momentum",
  "signals": {
    "social": {
      "status": "success",
      "summary": "Collected live social and public context evidence for mantle from Elfa, Surf, Docs, and HackQuest.",
      "providers": ["Elfa", "Surf", "Docs", "HackQuest"],
      "sourceIds": ["surf-web-0-example", "elfa-narrative-0-example"],
      "toolIds": []
    },
    "onchain": {
      "status": "partial",
      "summary": "On-chain enrichment produced usable evidence for mantle, but some provider coverage remained incomplete (Nansen).",
      "providers": ["Nansen", "Dune"],
      "sourceIds": [],
      "toolIds": ["smart_money.nansen_smart_money_netflow"]
    },
    "combined": {
      "status": "partial",
      "summary": "Social and on-chain signals diverged: public attention was visible, but the on-chain side remained weaker or incomplete.",
      "providers": ["Elfa", "Surf", "Nansen", "Dune"],
      "sourceIds": ["surf-web-0-example", "elfa-narrative-0-example"],
      "toolIds": ["smart_money.nansen_smart_money_netflow"]
    }
  },
  "report": {
    "kind": "smart-money",
    "title": "Mantle smart money report",
    "asOfUtc": "2026-05-23T04:48:00.000Z",
    "executiveSummary": "This run returned direct smart-money evidence for Mantle, but some provider coverage remained incomplete.",
    "bottomLine": "Treat the brief as directional research until the strongest flows are confirmed with a second source.",
    "confidence": "medium",
    "entities": [],
    "tables": [],
    "sections": [
      {
        "id": "combined-view",
        "title": "Combined View",
        "markdown": "Social and on-chain signals diverged: public attention was visible, but the on-chain side remained weaker or incomplete.",
        "sourceIds": ["surf-web-0-example", "elfa-narrative-0-example"],
        "toolIds": ["smart_money.nansen_smart_money_netflow"]
      }
    ],
    "caveats": [
      "Surf failed (402 Payment Required).",
      "Treat this brief as directional research rather than verified accumulation."
    ],
    "recommendations": [
      "Confirm wallet or holder flow with a second on-chain source before escalating the claim."
    ]
  },
  "providerTrace": [
    {
      "provider": "Surf",
      "status": "success",
      "scope": "mantle-premium",
      "message": "Collected 1 source card(s)."
    }
  ],
  "finalAnswer": {},
  "usage": {},
  "proof": {
    "storage": {
      "status": "prepared",
      "evidenceUri": "langclaw://evidence/run-id/0x..."
    },
    "chain": {
      "status": "anchored",
      "decisionHash": "0x...",
      "txHash": "0x..."
    },
    "compute": {
      "status": "used",
      "provider": "OpenAI",
      "model": "gpt-5-mini"
    }
  }
}
```

`signals.social`, `signals.onchain`, and `signals.combined` are always present for schema stability. Each section includes `status`, `summary`, `providers`, `sourceIds`, `toolIds`, and an optional `caveat`.

`report` is additive and preferred for UI rendering when present. It uses one shared contract across research and direct on-chain outputs:

- `kind`: `liquidity-anomaly`, `smart-money`, `market-brief`, `defi-yield`, or `mixed-research`
- `confidence`: `high`, `medium`, `low`, or `insufficient`
- `entities`: ranked entity cards only when the run includes real entity-level metrics
- `tables`: ranked tables only when the run includes direct row-level metrics
- `sections`: narrative markdown sections derived from the current run
- `caveats`: source of truth for final-answer caveat text
- `recommendations`: concrete next steps derived from the run

`providerTrace` is additive metadata that explains which providers succeeded, failed, or were skipped. Premium Surf/Elfa/Nansen traces appear only for Mantle in this phase. No request flag is required; the shared research workflow now attempts combined discovery plus on-chain enrichment by default and degrades honestly when a provider is out of scope, disabled, or fails upstream.

## Strategy Lab

`POST /api/strategy/backtest`

Runs the Liquidity Momentum Strategy against Dune historical rows for the requested product chain. The Dune result must include `timestamp`, `pair_address`, `price_usd`, `liquidity_usd`, and `volume_usd`; optional columns are `tx_count` and `net_whale_flow_usd`.

Request:

```json
{
  "chain": "mantle",
  "pairAddress": "0xeAfc4D6d4c3391Cd4Fc10c85D2f5f972d58C0dD5",
  "queryId": "1234567"
}
```

Response includes strategy parameters, parsed market bars, trades, equity curve, win rate, max drawdown, PnL, latest signal, Dune evidence metadata, and a trading journal proof with status `anchored`, `prepared`, `pending`, or `failed`.

`POST /api/strategy/scan-pairs`

Ranks pairs for the requested product chain from the configured Dune historical dataset and returns the best candidate plus a preview backtest. The scan considers trade count, total PnL, win rate, drawdown, total volume, latest signal, and signal confidence. It does not write on-chain; run `/api/strategy/backtest` on the selected pair to anchor the proof.

Request:

```json
{
  "chain": "mantle",
  "limit": 12,
  "queryId": "1234567"
}
```

`POST /api/strategy/paper-trade`

Creates a deterministic paper order from the latest backtest signal and records a `paper-opened` journal proof when the selected chain's trading journal is configured.

`POST /api/strategy/runs`

Lists recent `LangclawTradingJournal` records from the requested chain. If the journal contract is not configured, the response is honest and returns `configured: false` with a clear error.

## Wallet Auth

`POST /api/wallet/challenge`

Creates a nonce challenge for wallet login.

`POST /api/wallet/session`

Verifies the wallet signature and returns a short session token.

## Chat Sessions

`POST /api/chat/sessions`

Actions: `list`, `get`, `upsert`, `update`, `delete`.

## API Keys

`POST /api/api-keys`

Creates or manages Langclaw API keys after a wallet challenge with purpose `api-key:create`.

## Usage

`POST /api/usage/balance`

Reads the prepaid selected-chain ledger balance for `body.chain` (`mantle` or `celo`): MNT-backed credits on Mantle and USDT-backed credits on Celo.

`POST /api/usage/quote`

Returns estimated OpenAI usage pricing in internal wei-denominated units.

`POST /api/usage/deposit/verify`

Verifies a Mantle MNT or Celo USDT deposit to the selected chain's `LangclawUsageVault`.

`POST /api/usage/withdraw/request`

Returns withdrawal instructions and current withdrawable balance.

## Automation

`POST /api/automation/settings`

Reads or updates scheduled monitoring settings.

`POST /api/automation/tasks`

Creates, updates, pauses, or deletes scheduled Langclaw monitoring tasks.

`POST /api/automation/runs`

Lists automation run history.

`POST /api/automation/telegram/webhook`

Receives Telegram webhook updates.

## Environment

Core:

```bash
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_AGENT_MODEL=gpt-5.2
MANTLE_CHAIN_RPC_URL=https://rpc.mantle.xyz
MANTLE_CHAIN_ID=5000
MANTLE_ERC8004_AGENT_ID=94
MANTLE_LANGCLAW_REGISTRY_ADDRESS=0xe69755e4249c4978c39fbe847ca9674ce7af3505
MANTLE_LANGCLAW_TRADING_JOURNAL_ADDRESS=0xe96e9b76af8c8f32bfa2235d647186826d92fb7d
MANTLE_LANGCLAW_USAGE_VAULT_ADDRESS=0x7e93Ef361e7b54297cF963977bA829E47E59e8E1
MANTLE_TRADING_JOURNAL_ENABLED=true
CELO_CHAIN_RPC_URL=https://forno.celo.org
CELO_CHAIN_ID=42220
CELO_ERC8004_AGENT_ID=9109
CELO_LANGCLAW_REGISTRY_ADDRESS=0xe69755e4249c4978c39fbe847ca9674ce7af3505
CELO_LANGCLAW_TRADING_JOURNAL_ADDRESS=0x69984c20176704685236fd633192d7de1c13a5ec
CELO_LANGCLAW_USAGE_VAULT_ADDRESS=0x837a2948586de4e7638c742f99e520ffc049bcf7
CELO_TRADING_JOURNAL_ENABLED=true
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

Provider keys:

```bash
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=
GITHUB_TOKEN=
SURF_ENABLED=false
SURF_API_KEY=
SURF_TIMEOUT_MS=30000
NANSEN_ENABLED=false
NANSEN_API_KEY=
NANSEN_TIMEOUT_MS=30000
ELFA_ENABLED=false
ELFA_API_KEY=
ELFA_TIMEOUT_MS=45000
DUNE_API_KEY=
DUNE_STRATEGY_QUERY_ID=
ALCHEMY_API_KEY=
ETHERSCAN_API_KEY=
GOPLUS_API_KEY=
GOPLUS_API_SECRET=
```

Premium provider routing is Mantle-only in v1. Celo and other non-Mantle flows continue to use the legacy provider stack and surface a skipped provider trace instead of attempting Surf, Nansen, or Elfa.

## Errors

- `400`: malformed request.
- `401`: wallet auth missing or expired.
- `402`: insufficient prepaid balance.
- `500`: backend/provider failure.
