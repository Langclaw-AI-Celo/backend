# Celo Eligibility Runbook

This document tracks the repo-side work needed to keep Langclaw eligible for the Celo monthly requirements and gives a repeatable command path for re-checking status.

## Core Criteria

1. Deploy the product contracts on Celo mainnet and verify their source code in the explorer.
2. Keep the public GitHub repos clearly open source.
3. Keep the Celo AI agent registered with ERC-8004, registered with Self Agent ID, and backed by a wallet that has on-chain transactions.
4. Make sure the Project Leader can claim rewards in MiniPay before the next distribution window.
5. Treat Proof of Ship / MiniPay launch evidence as a booster, not a blocker.

## Current Celo Addresses

| Item | Value |
| --- | --- |
| Celo chain ID | `42220` |
| `LangclawRegistry` | `0xe69755e4249c4978c39fbe847ca9674ce7af3505` |
| `LangclawTradingJournal` | `0x69984c20176704685236fd633192d7de1c13a5ec` |
| `LangclawUsageVault` | `0x837a2948586de4e7638c742f99e520ffc049bcf7` |
| ERC-8004 identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Current Celo ERC-8004 agent ID | `9109` |
| Current Celo agent wallet | `0x2cA915EF6be8D2D48ccD3c5dAF715546AF873A4c` |
| Current ERC-8004 registration tx | `0x1b7cb74378db42551a3cbc81dcd560f337df1593d4ef1cd70ee44ff269bdc7f3` |
| Latest Celo decision proof | `#0` smart-money, tx `0x0e48bd059c782dd59a7834279388e0b2d305f9aba758c8fdb412e8eb55d2dc7d` |

## Current Verification Status

- `LangclawRegistry`: verified on Celoscan with `solc 0.8.35`, optimizer `200`, `viaIR: false`
- `LangclawTradingJournal`: verified on Celoscan with `solc 0.8.35`, optimizer `200`, `viaIR: true`
- `LangclawUsageVault`: live Celo vault is now the USDT-backed deployment at `0x837a2948586de4e7638c742f99e520ffc049bcf7`, verified on Celoscan
- Legacy Celo vault: the older native-only deployment at `0x6e1f381458229e8d1ee66d2a0121d4017596b97d` remains verified for historical reference via `backend/verification/celo-legacy-vault/src/LangclawUsageVault.sol`
- `LangclawRegistry` now has a recorded Celo demo decision for agent `9109`: decision `#0`, signal `smart-money`, tx `0x0e48bd059c782dd59a7834279388e0b2d305f9aba758c8fdb412e8eb55d2dc7d`

## Remaining Eligibility Gaps

- `Self Agent ID` is still not registered in the current environment.
- Verified Self registration still needs `CELO_SELF_HUMAN_PROOF` and `CELO_SELF_HUMAN_PROVIDER_DATA` from the Self proof flow.
- Public GitHub proof is evaluated from the actual GitHub organization and repositories. Backend and frontend are local Git clones with public origins. Optional `contracts` and `.github` repos should be verified separately if they are part of the public submission.

## Commands

Audit the current status from local env plus live chain and explorer data:

```bash
cd backend
npm run check:eligibility
```

Try automatic Celo contract verification. The script prefers Etherscan V2 / Celoscan when `ETHERSCAN_API_KEY` is available and falls back to Blockscout otherwise:

```bash
cd backend
npm run verify:celo-contracts
```

Print the exact build plus verification commands without submitting them:

```bash
cd backend
npm run verify:celo-contracts -- --dry-run
```

Export Standard JSON verification bundles for manual upload to Blockscout or Celoscan:

```bash
cd backend
npm run verify:celo-contracts -- --standard-json
```

Register or retry the Self Agent ID once the Self proof inputs are available:

```bash
cd backend
npm run register:agent -- --chain celo --self-agent-id --write-env
```

## Required Environment For Self Agent ID

The registration step will not succeed unless all of the following are present in the current process environment or `backend/.env`:

```bash
CELO_AGENT_PRIVATE_KEY=
CELO_SELF_HUMAN_PROOF=
CELO_SELF_HUMAN_PROVIDER_DATA=
CELO_SELF_HUMAN_PROOF_PROVIDER_ADDRESS=0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d
```

`CELO_SELF_AGENT_ID` and `CELO_SELF_AGENT_ONCHAIN_TX` are written after a successful registration.

Contract verification now also expects:

```bash
ETHERSCAN_API_KEY=
```

The deploy path that produced the currently verified Celo contracts used the backend `solc` package, not Foundry's default `solc 0.8.24` profile. The verifier script rebuilds each target with the deploy-matching settings:

- `LangclawRegistry`: `solc 0.8.35`, optimizer `200`, `viaIR: false`
- `LangclawTradingJournal`: `solc 0.8.35`, optimizer `200`, `viaIR: true`
- `LangclawUsageVault`: `solc 0.8.35`, optimizer `200`, `viaIR: true`; the verifier probes the live address and uses either the current USDT-backed source or the archived legacy native-only snapshot

## Explorer Targets

Primary Celo explorer pages used in the monthly audit:

- Registry: [Celoscan](https://celoscan.io/address/0xe69755e4249c4978c39fbe847ca9674ce7af3505#code)
- Trading journal: [Celoscan](https://celoscan.io/address/0x69984c20176704685236fd633192d7de1c13a5ec#code)
- Usage vault: [Celoscan](https://celoscan.io/address/0x837a2948586de4e7638c742f99e520ffc049bcf7#code)
- Blockscout verification surface: [celo.blockscout.com](https://celo.blockscout.com/)

If automatic verification fails, export the Standard JSON bundle and upload it manually. The verifier now probes the live vault address: modern USDT-backed vaults use `contracts/src/LangclawUsageVault.sol`, while the archived native-only Celo vault uses `backend/verification/celo-legacy-vault/src/LangclawUsageVault.sol`.
