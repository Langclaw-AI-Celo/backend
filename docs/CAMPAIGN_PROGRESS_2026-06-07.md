# Campaign Progress Snapshot: 2026-06-07

This snapshot records the repo-visible Langclaw Celo campaign state after the
June 7 live proof recheck confirmed that the latest ERC-8004 record moved to
the backend proof run.

## Repo Heads

| Repo | Branch | Head |
| --- | --- | --- |
| `backend` | `main` | `1b7daf0` |
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

## June 6 Backend Proof Sequence

| Decision | Run | Evidence | Transaction |
| --- | --- | --- | --- |
| `#36` | `github-backend-2930d6d-2026-06-06` | `https://github.com/Langclaw-AI-Celo/backend/commit/2930d6d7f2e89a6297037da80ac134bd179c0a1e` | `0xe7956e239480d208870b8309f23fa28fb23a09bf0064fb4cef4025a3c9c49116` |
| `#37` | `github-backend-2abcb2f-2026-06-06` | `https://github.com/Langclaw-AI-Celo/backend/commit/2abcb2f70f458cb0f8271894802b9bf88ff155bf` | `0x96a77f2ef7a3bae6f8b2dfeac9817dbb226c98dc67b1f7e9249e3f9de263df90` |
| `#38` | `github-backend-650d33c-2026-06-06` | `https://github.com/Langclaw-AI-Celo/backend/commit/650d33c80a2a54c5a706c79722a6eeeaa5dd4fd8` | `0x4485061e6e6151bc51c106f025b7d062468121595ca5cb4198f7307ea5ec5f06` |

## What This Pass Corrected

- `npm run check:celo-proof -- --json` now shows `nextDecisionId: 39` with
  latest decision `#38` belonging to the configured ERC-8004 campaign agent.
- Backend current docs now reference the live backend proof run instead of the
  older `.github` proof example.
- The latest public proof story is now the backend evidence commit
  `650d33c80a2a54c5a706c79722a6eeeaa5dd4fd8` and decision tx
  `0x4485061e6e6151bc51c106f025b7d062468121595ca5cb4198f7307ea5ec5f06`.
- The proof history for June 6 now captures the three consecutive backend
  campaign anchors that advanced the registry from decision `#36` to `#38`.

## Remaining Campaign Evidence To Keep Fresh

- MiniPay screenshots or recording for connect flow, Celo mainnet state, USDT
  approval, deposit, and verified crediting.
- Proof Center screenshot showing the latest registry decision and strategy
  proof rows.
- Any new public demo, grant, or submission links that should also be mirrored
  into `.github/profile/README.md`.
- Any newer live Celo decision proof transaction hash once a genuinely new
  record is intentionally broadcast.
