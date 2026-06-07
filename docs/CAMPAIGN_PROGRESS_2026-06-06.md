# Campaign Progress Snapshot: 2026-06-06

This snapshot records the repo-visible Langclaw Celo campaign state after the
June 6 backend proof-agent precedence fix and doc refresh.

## Repo Heads

| Repo | Branch | Head |
| --- | --- | --- |
| `backend` | `main` | `2930d6d` |
| `frontend` | `main` | `42d130c` |
| `contracts` | `main` | `62093a9` |
| `.github` | `main` | `e663d75` |

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
| Latest ERC-8004 decision proof | Decision `#38`, signal `campaign-backend-proof`, tx `0x4485061e6e6151bc51c106f025b7d062468121595ca5cb4198f7307ea5ec5f06` |
| Latest Self-linked decision proof | Decision `#1`, signal `smart-money`, tx `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |
| Latest ERC-8004 proof run | `github-backend-650d33c-2026-06-06` |
| Latest ERC-8004 proof evidence | `https://github.com/Langclaw-AI-Celo/backend/commit/650d33c80a2a54c5a706c79722a6eeeaa5dd4fd8` |

## What This Pass Corrected

- Backend proof-readiness, direct proof writes, and trading-journal defaults now
  prefer `CELO_ERC8004_AGENT_ID=9109` before `CELO_SELF_AGENT_ID=133`.
- `npm run check:celo-proof -- --json` now reports `ready: true` with the
  latest registry decision matching the configured ERC-8004 campaign agent.
- The June 6 public proof story ended on the backend evidence run
  `github-backend-650d33c-2026-06-06`, even though repo head later advanced to
  backend commit `2930d6d` for snapshot test alignment.
- Backend, contracts, and `.github` docs now describe Self Agent ID as a
  linked-proof and human-verification path, not the primary campaign proof
  writer.
- Backend doc tests now guard the contracts README and public GitHub profile
  against proof-story drift.

## Remaining Campaign Evidence To Keep Fresh

- MiniPay screenshots or recording for connect flow, Celo mainnet state, USDT
  approval, deposit, and verified crediting.
- Proof Center screenshot showing the latest registry decision and strategy
  proof rows.
- Any new public demo, grant, or submission links that should also be mirrored
  into `.github/profile/README.md`.
- Any new live Celo decision proof transaction hash once a genuinely new record
  is intentionally broadcast.
