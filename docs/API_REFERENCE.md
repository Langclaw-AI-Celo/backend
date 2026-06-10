# Langclaw API Reference

Backend base URL defaults to `http://localhost:3001`. In frontend local/proxy
mode the same API is usually reached through `/api/backend/*`.

## Authentication Model

Account-scoped routes accept either wallet session material in `body.wallet` or
the matching auth headers produced by the frontend wallet session helpers.

Research routes also require a linked Telegram chat in automation notification
settings. If the wallet is not authenticated the API returns `401`; if Telegram
is missing it returns `403`; if prepaid usage balance is insufficient it returns
`402`.

## Health

### `GET /health`

Returns:

```json
{
  "ok": true,
  "service": "langclaw-backend"
}
```

## Chat

### `POST /api/chat/stream`

Streams newline-delimited JSON. Direct chat calls OpenAI. Research mode runs the
Langclaw workflow, reserves usage balance, and can record selected-chain proof.

Request:

```json
{
  "message": "Find smart-money accumulation on Celo",
  "toolMode": "research",
  "chain": "celo",
  "model": "gpt-5.4-nano",
  "wallet": {
    "address": "0x...",
    "sessionToken": "..."
  }
}
```

Important stream event types:

| Type | Meaning |
| --- | --- |
| `direct_reasoning_delta` | Direct-chat reasoning/status copy |
| `direct_delta` | Direct chat token delta |
| `direct` | Final direct chat payload |
| `mode` | Agent mode marker |
| `progress` | Workflow step progress |
| `tool_plan` | Planned on-chain tool calls |
| `tool_call` | Tool call started |
| `tool_result` | Tool call result |
| `result` | Final research payload |
| `error` | Stream failure |

Research `result.payload` includes:

- `signals.social`, `signals.onchain`, and `signals.combined`
- `report`
- `alphaSignal`
- `providerTrace`
- `finalAnswer`
- `usage`
- `proof`

Tool results can include additive metadata:

- `attemptedProviders`
- `fallbackReason`
- `scope`: `celo-premium`, `mantle-premium`, `legacy-fallback`,
  `legacy-default`, or `out-of-scope`

### `POST /api/chat/sessions`

Creates, lists, loads, updates, and deletes wallet-scoped chat sessions.

The route uses an action-based body. Typical actions are `list`, `get`,
`upsert`, `update`, and `delete`.

## Research

### `POST /api/discover`

Runs the Celo Alpha workflow and returns one JSON payload.

Request:

```json
{
  "topic": "Rank Celo protocols by TVL and yield momentum",
  "wallet": {
    "address": "0x...",
    "sessionToken": "..."
  }
}
```

### `POST /api/discover/stream`

Streams workflow progress and then the final research payload. Use this when the
frontend needs step-by-step progress outside the chat session surface.

Both discover routes require account auth, linked Telegram, and sufficient usage
balance.

## Research Payload Contract

Example abbreviated payload:

```json
{
  "topic": "Detect liquidity anomalies on Celo DEX pairs",
  "signals": {
    "social": {
      "status": "partial",
      "summary": "Collected usable public context for Celo.",
      "providers": ["Surf", "Elfa"],
      "sourceIds": ["surf-web-0"],
      "toolIds": []
    },
    "onchain": {
      "status": "success",
      "summary": "Celo DEX pair evidence was available.",
      "providers": ["Dune", "DEX Screener"],
      "sourceIds": [],
      "toolIds": ["pair_liquidity.liquidity_pair_search"]
    },
    "combined": {
      "status": "partial",
      "summary": "On-chain evidence is usable, with social coverage caveats.",
      "providers": ["Surf", "Elfa", "Dune", "DEX Screener"],
      "sourceIds": ["surf-web-0"],
      "toolIds": ["pair_liquidity.liquidity_pair_search"]
    }
  },
  "report": {
    "kind": "liquidity-anomaly",
    "title": "Celo liquidity anomaly report",
    "asOfUtc": "2026-05-28T00:00:00.000Z",
    "executiveSummary": "The run found Celo pair movement worth review.",
    "bottomLine": "Treat this as a watchlist candidate until confirmed.",
    "confidence": "medium",
    "entities": [],
    "tables": [],
    "sections": [],
    "caveats": ["Some provider coverage was incomplete."],
    "recommendations": ["Confirm the pair with a second source."]
  },
  "alphaSignal": {
    "schema": "langclaw.alpha-signal.v1",
    "signalType": "liquidity-anomaly",
    "alertEligible": true,
    "quality": {
      "score": 82,
      "label": "high",
      "evidenceCount": 4,
      "sourceCoverage": {
        "social": true,
        "onchain": true,
        "directWalletFlow": false,
        "proof": true,
        "providerCount": 3
      },
      "falsePositiveChecks": [],
      "reasons": ["Quality score 82/100 is high."]
    }
  },
  "providerTrace": [
    {
      "provider": "Surf",
      "status": "success",
      "scope": "celo-premium",
      "message": "Collected source cards."
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
      "chain": "celo",
      "chainId": 42220,
      "decisionHash": "0x...",
      "decisionId": "1",
      "agentId": "133",
      "signalType": "smart-money",
      "txHash": "0x..."
    },
    "compute": {
      "status": "used",
      "provider": "OpenAI",
      "requestedModel": "gpt-5.4-nano",
      "usedModel": "gpt-5.4-nano"
    }
  }
}
```

`signals` is schema-stable. `report` is additive and preferred for UI rendering.
Ranked entities and tables should appear only when the run includes real
entity-level or row-level metrics.

## Wallet Auth

### `POST /api/wallet/challenge`

Creates a nonce challenge for wallet login or API-key creation.

### `POST /api/wallet/session`

Verifies the signed wallet challenge and returns a short session token.

## API Keys

### `POST /api/api-keys`

Creates, lists, and revokes wallet-scoped API keys after a wallet challenge with
the correct purpose. API keys are HMAC-protected with `LANGCLAW_API_KEY_PEPPER`.

## Memory

### `POST /api/memory`

Lists, updates, and deletes wallet-scoped memory records.

### `POST /api/memory/settings`

Reads and updates wallet-scoped memory settings.

## Watchlist

### `POST /api/watchlist`

Lists, upserts, deletes, or clears Alpha Watchlist items for the authenticated
wallet. Watchlist items are saved Celo intelligence signals with title, summary,
source counts, source gaps, proof metadata, and follow-up context.

## Usage

### `POST /api/usage/balance`

Reads the prepaid selected-chain usage balance.

Request:

```json
{
  "chain": "celo",
  "wallet": {
    "address": "0x...",
    "sessionToken": "..."
  }
}
```

### `POST /api/usage/quote`

Returns estimated model usage pricing in internal wei-denominated ledger units.

Request:

```json
{
  "chain": "celo"
}
```

### `POST /api/usage/vault`

Returns selected-chain vault metadata, billing currency metadata, vault address,
withdrawal authority, and configuration status.

### `POST /api/usage/deposit/verify`

Verifies a Mantle MNT or Celo USDT deposit transaction against the selected
chain's `LangclawUsageVault`, then credits the internal ledger.

For the current Celo deployment, users approve Celo USDT
`0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` and deposit into
`LangclawUsageVault` `0x837a2948586de4e7638c742f99e520ffc049bcf7`. The
verification route does not move funds itself; it reads the on-chain deposit
event, matches the wallet and deposit reference, then credits the app ledger
after the transaction is confirmed.

Request:

```json
{
  "chain": "celo",
  "txHash": "0x...",
  "depositReference": "0x...",
  "wallet": {
    "address": "0x...",
    "sessionToken": "..."
  }
}
```

### `POST /api/usage/withdraw/request`

Returns withdrawal instructions and current withdrawable balance. On-chain
withdrawal still requires the user to send the vault transaction from their
wallet after the backend authorizes it.

## Automation

### `POST /api/automation/settings`

Reads or updates wallet-scoped automation settings, including notification
preferences.

### `POST /api/automation/tasks`

Creates, lists, updates, pauses, resumes, runs, or deletes scheduled monitoring
tasks.

### `POST /api/automation/runs`

Lists automation run history or runs a task immediately depending on action.

### `POST /api/automation/notifications`

Lists in-app notifications, marks notifications read, links email, links
Telegram, polls Telegram link status, and unlinks channels.

### `POST /api/automation/telegram/webhook`

Receives Telegram webhook updates.

### `POST /api/automation/webhooks/:slug`

Receives task-specific webhook callbacks.

## Proof

### `POST /api/proofs/readiness`

Checks whether the selected product chain can record and read Langclaw proof
records before a demo.

Request:

```json
{
  "chain": "celo"
}
```

Response:

```json
{
  "chain": "celo",
  "chainId": 42220,
  "status": "ready",
  "ready": true,
  "checks": [
    {
      "id": "registry-readable",
      "status": "pass",
      "summary": "LangclawRegistry is readable."
    }
  ]
}
```

CLI equivalent:

```bash
npm run check:celo-proof
```

### `POST /api/proofs/decisions`

Returns latest `LangclawRegistry` decisions for Proof Center.

Request:

```json
{
  "chain": "celo",
  "limit": 25
}
```

## Strategy Lab

### `POST /api/strategy/scan-pairs`

Ranks pairs for the requested product chain from the configured Dune historical
dataset and returns the best candidate plus a preview backtest.

Request:

```json
{
  "chain": "celo",
  "limit": 12,
  "queryId": "1234567"
}
```

### `POST /api/strategy/backtest`

Runs the Liquidity Momentum Strategy against Dune historical rows. The Dune
result should include `timestamp`, `pair_address`, `price_usd`, `liquidity_usd`,
and `volume_usd`; optional columns include `tx_count` and
`net_whale_flow_usd`.

Request:

```json
{
  "chain": "celo",
  "pairAddress": "0x365722f12ceb2063286a268b03c654df81b7c00f",
  "queryId": "1234567"
}
```

Response includes strategy parameters, parsed market bars, trades, equity curve,
win rate, max drawdown, PnL, latest signal, Dune evidence metadata, and a
trading journal proof with status `anchored`, `prepared`, `pending`, or
`failed`.

### `POST /api/strategy/paper-trade`

Creates a deterministic paper order from the latest backtest signal and records
a `paper-opened` journal proof when the selected chain's trading journal is
configured.

### `POST /api/strategy/runs`

Lists recent `LangclawTradingJournal` records from the requested chain. If the
journal is not configured, the response is honest and returns configuration
status or a clear error.

## Environment Summary

Core:

```bash
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-5-mini
OPENAI_AGENT_MODEL=gpt-5.2
CELO_CHAIN_RPC_URL=https://forno.celo.org
CELO_CHAIN_ID=42220
CELO_ERC8004_AGENT_ID=9109
CELO_SELF_AGENT_ID=133
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
ELFA_ENABLED=false
ELFA_API_KEY=
DUNE_API_KEY=
DUNE_STRATEGY_QUERY_ID=
ALCHEMY_API_KEY=
ETHERSCAN_API_KEY=
GOPLUS_API_KEY=
GOPLUS_API_SECRET=
```

Mantle env values remain supported for explicit Mantle analysis, but Celo is the
default product chain.

## Error Statuses

| Status | Meaning |
| --- | --- |
| `400` | Malformed request or missing required body field |
| `401` | Wallet/API authentication missing or expired |
| `402` | Insufficient prepaid usage balance |
| `403` | Telegram chat is not linked |
| `404` | Route not found |
| `500` | Backend, provider, or chain failure |
