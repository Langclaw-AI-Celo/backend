# Campaign Progress Snapshot: 2026-06-05

This snapshot records the repo-visible Langclaw Celo campaign state after the
June 6 proof-readiness recheck.

## Repo Heads

| Repo | Branch | Head |
| --- | --- | --- |
| `backend` | `main` | `7411dd0` |
| `frontend` | `main` | `c8a21d2` |
| `contracts` | `main` | `5432642` |
| `.github` | `main` | `0a2f854` |

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
| Latest ERC-8004 decision proof | Decision `#35`, signal `campaign-github-proof`, tx `0x185ee10c7d95546fa9ff7bdacf5a81023646c5a8333ab31bdd2e3c4fb23c8e96` |
| Latest Self-linked decision proof | Decision `#1`, signal `smart-money`, tx `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

## What This Pass Corrected

- Backend proof-consistency coverage now keeps the README, eligibility runbook,
  hackathon submission, smart-contract notes, and active campaign snapshots on
  the same live Celo proof claims.
- The live proof-readiness check now points at decision `#35`, run
  `github-org-profile-0a2f854-2026-06-05`, and the matching public `.github`
  evidence commit
  `https://github.com/Langclaw-AI-Celo/.github/commit/0a2f8540e196cd75935e3d59980e710d10821d70`.
- Frontend home proof surfaces now show the latest ERC-8004 decision example,
  label the Self Agent ID registration card accurately, and document the new
  proof-copy verification commands in the README.
- The public GitHub profile now dates its live-proof recheck note to the
  latest documented backend snapshot and proof-readiness pass.

## Remaining Campaign Evidence To Keep Fresh

- MiniPay screenshots or recording for connect flow, Celo mainnet state, USDT
  approval, deposit, and verified crediting.
- Proof Center screenshot showing the latest registry decision and strategy
  proof rows.
- Any new public demo, grant, or submission links that should also be mirrored
  into `.github/profile/README.md`.
- Any new live Celo decision proof transaction hash once a genuinely new record
  is intentionally broadcast.
