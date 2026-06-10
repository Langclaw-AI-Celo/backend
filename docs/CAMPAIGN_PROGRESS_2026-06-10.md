# Campaign Progress Snapshot: 2026-06-10

This snapshot records the local repo-visible Langclaw Celo campaign state after
the workspace was imported into a single git root containing `frontend`,
`backend`, `contracts`, and `.github`.

## Local Workspace Head

| Scope | Branch | Head |
| --- | --- | --- |
| Monorepo workspace | `main` | `5e5417c` |

The public campaign surfaces still map to `frontend`, `backend`, `contracts`,
and `.github`, but this checkout now tracks those folders from one root commit
history. Use the folder docs below as the source of truth for each surface.

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

- The campaign docs now distinguish the current single-root local checkout from
  the public `Langclaw-AI-Celo` repository links.
- The latest live proof story remains unchanged: ERC-8004 decision `#38`,
  signal `campaign-backend-proof`, and tx
  `0x4485061e6e6151bc51c106f025b7d062468121595ca5cb4198f7307ea5ec5f06`.
- Self Agent ID `133` remains documented as the linked-proof path rather than
  the default campaign proof writer.

## Remaining Campaign Evidence To Keep Fresh

- MiniPay screenshots or recording for connect flow, Celo mainnet state, USDT
  approval, deposit, and verified crediting.
- Proof Center screenshot showing the latest registry decision and strategy
  proof rows.
- Any new public demo, grant, or submission links that should also be mirrored
  into `.github/profile/README.md`.
- Any newer live Celo decision proof transaction hash once a genuinely new
  record is intentionally broadcast.
