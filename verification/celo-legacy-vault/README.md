# Celo Legacy Vault Verification

This folder stores the exact `LangclawUsageVault` source snapshot needed to verify the archived native-only Celo contract at `0x6e1f381458229e8d1ee66d2a0121d4017596b97d`.

The deployed Celo vault is a legacy native-only variant:

- constructor: `constructor(address initialOwner, address initialWithdrawalAuthority)`
- compiler: `solc 0.8.35`
- optimizer: `200`
- `viaIR: true`
- OpenZeppelin dependency set: `openzeppelin-contracts v5.5.0`

It does not match the newer token-support source in `contracts/src/LangclawUsageVault.sol`. `backend/scripts/verify-celo-contracts.mjs` probes the live vault address and falls back to this snapshot only when the address is still pointing at the archived native-only deployment.
