# Langclaw API Reference

Backend base URL defaults to `http://localhost:3001`.

## Health

`GET /health`

Returns `{ "ok": true, "service": "langclaw-backend" }`.

## Chat

`POST /api/chat/stream`

Streams newline-delimited JSON. Direct chat uses OpenAI Responses API. Research mode runs the Langclaw workflow and can record selected-chain decision proof.

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

## Research

`POST /api/discover`

Runs the Mantle Alpha workflow and returns a single JSON payload.

`POST /api/discover/stream`

Streams workflow progress before the final payload.

The response includes source cards, provider gaps, final answer, usage receipt, and proof metadata:

```json
{
  "topic": "Rank Mantle protocols by TVL and yield momentum",
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
DUNE_API_KEY=
DUNE_STRATEGY_QUERY_ID=
ALCHEMY_API_KEY=
ETHERSCAN_API_KEY=
GOPLUS_API_KEY=
GOPLUS_API_SECRET=
```

## Errors

- `400`: malformed request.
- `401`: wallet auth missing or expired.
- `402`: insufficient prepaid balance.
- `500`: backend/provider failure.
