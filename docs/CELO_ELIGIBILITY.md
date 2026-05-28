# Celo Eligibility Runbook

This document tracks repo-side work needed to keep Langclaw aligned with Celo
monthly requirements and gives a repeatable command path for rechecking status.

## Core Criteria

1. Deploy the product contracts on Celo mainnet.
2. Verify the deployed contract source in a public explorer.
3. Keep the public GitHub repositories open source and aligned with the current
   product state.
4. Keep the Celo AI agent registered with ERC-8004.
5. Keep the agent linked to Self Agent ID and backed by a wallet with on-chain
   transactions.
6. Keep MiniPay reward-claim operations ready for the Project Leader.
7. Treat Proof of Ship and MiniPay launch artifacts as score boosters, not base
   blockers.

## Current Celo Addresses

| Item | Value |
| --- | --- |
| Celo chain ID | `42220` |
| Agent wallet / recorder | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| `LangclawRegistry` | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| `LangclawTradingJournal` | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| `LangclawUsageVault` | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| Celo USDT deposit token | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Celo ERC-8004 agent ID | `9109` |
| Self Agent ID | `133` |
| ERC-8004 registration tx | `0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3` |
| Self Agent ID registration tx | `0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6` |
| Latest Celo decision proof | Decision `#1`, signal `smart-money`, agent `133`, tx `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211` |

The Celo MCP live check on 2026-05-28 confirmed Celo mainnet connectivity and
transaction status `1` for the ERC-8004 registration, Self Agent ID
registration, and latest decision proof transactions.

## Current Verification Status

- `LangclawRegistry` is deployed on Celo and verified on Celoscan.
- `LangclawTradingJournal` is deployed on Celo and verified on Celoscan.
- `LangclawUsageVault` is deployed on Celo as the USDT-backed vault at
  `0x837a2948586de4e7638c742f99e520ffc049bcf7` and verified on Celoscan.
- The archived native-only Celo vault at
  `0x6e1f381458229e8d1ee66d2a0121d4017596b97d` remains verified for historical
  reference through `backend/verification/celo-legacy-vault/src/LangclawUsageVault.sol`.
- `LangclawRegistry` has a recorded demo decision for Self Agent ID `133`:
  decision `#1`, signal `smart-money`, tx
  `0x2a2f94c40e2b5c080bd330f43f3ce6bc6b05e054b6626ce3ab2716220f0d3211`.

## Eligibility Notes

- Self Agent ID is registered and verified on Celo in the current project state.
- A verified Self linked-flow transaction satisfies the Self human proof check.
- Raw `CELO_SELF_HUMAN_PROOF` and `CELO_SELF_HUMAN_PROVIDER_DATA` are required
  only when registering through the local script instead of the official Self
  linked flow.
- Public GitHub proof is evaluated from the actual GitHub organization and
  repositories. Recheck `.github`, `backend`, `contracts`, and `frontend`
  origins before submitting.
- MiniPay support exists in the frontend. The reward claim itself is still an
  external Project Leader operation.

## Commands

Audit current status from local env plus live chain and explorer data:

```bash
cd backend
npm run check:eligibility
```

Check proof-readiness for the configured Celo registry:

```bash
cd backend
npm run check:celo-proof
```

Try automatic Celo contract verification. The script prefers Etherscan V2 /
Celoscan when `ETHERSCAN_API_KEY` is available and falls back to Blockscout
paths when applicable:

```bash
cd backend
npm run verify:celo-contracts
```

Print build and verification commands without submitting them:

```bash
cd backend
npm run verify:celo-contracts -- --dry-run
```

Export Standard JSON verification bundles for manual upload:

```bash
cd backend
npm run verify:celo-contracts -- --standard-json
```

Register or retry Self Agent ID locally only when the official linked Self flow
is not used:

```bash
cd backend
npm run register:agent -- --chain celo --self-agent-id --write-env
```

## Direct Self Agent ID Environment

The local registration script needs the following values in the current process
environment or `backend/.env`:

```bash
CELO_AGENT_PRIVATE_KEY=
CELO_SELF_HUMAN_PROOF=
CELO_SELF_HUMAN_PROVIDER_DATA=
CELO_SELF_HUMAN_PROOF_PROVIDER_ADDRESS=0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d
```

The current project already has:

```bash
CELO_SELF_AGENT_ID=133
CELO_SELF_AGENT_ONCHAIN_TX=0x3c7d0cc69f77d2aef5ab21bfe703d0f33f7037d5e2162209d78b23b5c3f1cde6
```

## Contract Verification Environment

```bash
ETHERSCAN_API_KEY=
```

The deploy path that produced the currently verified Celo contracts used the
backend `solc` package and deploy-matching settings:

| Contract | Compiler | Optimizer | viaIR |
| --- | --- | --- | --- |
| `LangclawRegistry` | `solc 0.8.35` | `200` | `false` |
| `LangclawTradingJournal` | `solc 0.8.35` | `200` | `true` |
| `LangclawUsageVault` | `solc 0.8.35` | `200` | `true` |

The verifier probes the live vault address and chooses the current USDT-backed
source or the archived legacy native-only snapshot as needed.

## Explorer Targets

- Registry:
  [Celoscan](https://celoscan.io/address/0xe69755e4249c4978c39fbe847ca9674ce7af3505#code)
- Trading journal:
  [Celoscan](https://celoscan.io/address/0x69984c20176704685236fd633192d7de1c13a5ec#code)
- Usage vault:
  [Celoscan](https://celoscan.io/address/0x837a2948586de4e7638c742f99e520ffc049bcf7#code)
- Blockscout fallback:
  [celo.blockscout.com](https://celo.blockscout.com/)

If automatic verification fails, export Standard JSON and upload it manually.

## Monthly Evidence Pack

Keep these artifacts before each claim or review window:

- Public repository links for frontend, backend, contracts, and profile.
- Celoscan code links for the three live Celo contracts.
- ERC-8004 registration transaction.
- Self Agent ID registration transaction.
- Latest `LangclawRegistry` decision transaction.
- MiniPay app screenshot or recording.
- Celo USDT usage-credit flow screenshot or recording.
- Proof Center screenshot showing agent decisions and strategy proofs.
- Project Leader reward-claim confirmation when available.
