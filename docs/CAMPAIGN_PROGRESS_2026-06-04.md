# Campaign Progress Snapshot: 2026-06-04

This snapshot records the repo-visible Langclaw Celo campaign state after the
latest documentation and proof-readiness maintenance on 2026-06-04.

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
| Latest ERC-8004 decision proof | Decision `#2`, signal `campaign-github-proof`, tx `0xee9cff177445dd221491a9a4d70810a0f09aaf8ca16c010940dd2d3bf69632e9` |
| Latest Self-linked decision proof | Decision `#1`, signal `smart-money`, tx `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

## What Recent Repo Work Landed

- Backend docs now include refreshed Celo sample evidence plus campaign progress
  snapshots grounded in current proof references.
- Frontend README and tests now cover the MiniPay regression verification path
  and the Celo-native chain labels used in Strategy Lab and Proof Center.
- Contracts docs now state that the live usage vault is USDT-backed and rejects
  native CELO deposits on the current Celo deployment.
- The public GitHub profile mirrors the same Celo-first product, proof, and
  MiniPay claims as the backend and contracts docs.

## Remaining Campaign Evidence To Keep Fresh

- MiniPay screenshots or recording for connect flow, Celo mainnet state, USDT
  approval, deposit, and verified crediting.
- Proof Center screenshot showing the latest registry decision and strategy
  proof rows.
- Any new public demo, grant, or submission links that should also be mirrored
  into `.github/profile/README.md`.
- Any new live Celo decision proof transaction hash once a genuinely new record
  is intentionally broadcast.
