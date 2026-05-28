# Celo Legacy Vault Verification Snapshot

This folder stores the exact `LangclawUsageVault` source snapshot needed to
verify the archived native-only Celo contract at
`0x6e1f381458229e8d1ee66d2a0121d4017596b97d`.

The current live Celo usage vault is the USDT-backed deployment at
`0x837a2948586de4e7638c742f99e520ffc049bcf7`. Use this legacy folder only when
the verifier detects or audits the older native-only deployment.

## Archived Deployment Shape

- Constructor: `constructor(address initialOwner, address initialWithdrawalAuthority)`
- Compiler: `solc 0.8.35`
- Optimizer runs: `200`
- `viaIR`: `true`
- Dependency set: `openzeppelin-contracts v5.5.0`

## Why This Exists

The archived deployment does not match the newer token-support source in
`contracts/src/LangclawUsageVault.sol`. `backend/scripts/verify-celo-contracts.mjs`
probes the live vault address and falls back to this snapshot only when the
address points at the archived native-only deployment.

Do not use this snapshot for new deployments.
