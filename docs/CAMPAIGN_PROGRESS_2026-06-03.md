# Campaign Progress Snapshot: 2026-06-03

This snapshot records the current repo-visible Langclaw Celo campaign state so
GitHub work, proof references, and remaining evidence collection stay auditable.

## Repo Heads

| Repo | Branch | Head |
| --- | --- | --- |
| `backend` | `main` | `56c4ee6` |
| `frontend` | `main` | `199a95e` |
| `contracts` | `main` | `2210bd2` |
| `.github` | `main` | `2468ee2` |

## Repo-Tracked Celo Proof References

| Item | Value |
| --- | --- |
| Product chain | Celo mainnet `42220` |
| `LangclawRegistry` | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| `LangclawTradingJournal` | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| `LangclawUsageVault` | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| Usage vault deposit token | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Agent wallet / recorder | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| ERC-8004 agent ID | `9109` |
| Self Agent ID | `133` |
| ERC-8004 registration tx | `0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3` |
| Self Agent ID registration tx | `0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6` |
| Latest repo-tracked decision proof | Decision `#2`, signal `campaign-github-proof`, tx `0xee9cff177445dd221491a9a4d70810a0f09aaf8ca16c010940dd2d3bf69632e9` |
| Latest Self-linked decision proof | Decision `#1`, signal `smart-money`, tx `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

## What This Run Shipped

- Backend config/docs now include `*_LANGCLAW_USAGE_VAULT_DEPOSIT_TOKEN` in the
  sample environment flow.
- Backend proof-readiness coverage now tests recorder fallback from
  `CELO_AGENT_PRIVATE_KEY` to `CELO_PRIVATE_KEY`.
- Frontend strategy and proof selectors now show the chain gas symbol instead of
  inheriting a billing-style token label.
- Contracts docs now state that the live Celo usage vault is USDT-backed and
  rejects native CELO deposits.

## Remaining Campaign Evidence To Keep Fresh

- MiniPay screenshots or recording for connect flow, Celo mainnet state, and
  USDT credits path.
- Proof Center screenshot showing the latest registry decision and strategy
  proof rows.
- Any new public demo or submission links that should be mirrored into
  `.github/profile/README.md`.
- Any new live decision proof transaction hash once a new Celo registry record
  is intentionally broadcast.
