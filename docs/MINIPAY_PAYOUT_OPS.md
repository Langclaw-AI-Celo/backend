# MiniPay Payout Ops Checklist

This checklist covers manual, non-code steps that remain outside the repo for
monthly reward claims and MiniPay booster evidence.

## Project Leader Claim Checklist

- Confirm the Project Leader controls the MiniPay wallet that will receive the
  payout.
- Confirm the payout Mini App is reachable from the same MiniPay account used
  for claiming.
- Confirm the project profile, Talent App record, and MiniPay account identify
  the same Project Leader.
- Claim rewards before the next distribution window starts.
- Save the payout confirmation screenshot, transaction hash, and claim date.
- Keep an internal note with campaign name, month, wallet address, and claimed
  amount.

## Evidence To Keep

- Project Leader MiniPay wallet address or alias.
- Claim transaction hash.
- Claim confirmation screenshot.
- Claim date and timezone.
- Program name and month.
- Public repository links.
- Demo URL or production URL.
- Celo contract explorer links.
- Proof Center screenshot showing Celo records.

## MiniPay App Evidence

Proof of Ship and live MiniPay readiness are score boosters, not base blockers.
Keep these artifacts available:

- Deployed Mini App URL.
- Screenshot or recording of the MiniPay connect flow.
- Screenshot showing Celo mainnet selected.
- Screenshot showing Celo USDT usage-credit path.
- Screenshot showing connected wallet balance or usage balance.
- Screenshot of a Celo Intelligence result inside the MiniPay/mobile context.
- Any Proof of Ship submission or acceptance artifact.

## Repo State To Confirm

- Frontend contains MiniPay detection through `window.ethereum.isMiniPay`.
- MiniPay path resolves to Celo mainnet `42220`.
- Celo USDT usage vault address is documented:
  `0x837a2948586de4e7638c742f99e520ffc049bcf7`.
- Celo USDT token address is documented:
  `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`.
- Backend eligibility command passes or returns only known manual follow-ups.

The current reward-claim-ready deposit path is:

1. Open the Mini App inside MiniPay on Celo mainnet `42220`.
2. Approve Celo USDT `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`.
3. Deposit into `LangclawUsageVault`
   `0x837a2948586de4e7638c742f99e520ffc049bcf7`.
4. Capture the proof artifacts listed above after verification succeeds.

## Timing

Do not wait until the last day of the reward cycle. Treat the claim window as an
ops deadline owned by the Project Leader, separate from code readiness.

Recommended cadence:

1. One week before claim window: verify app URL, MiniPay flow, and Celo proof
   links.
2. Two days before claim window: capture screenshots and refresh eligibility
   command output.
3. Claim day: claim from the Project Leader MiniPay account and save proof.
4. After claim: update this checklist if any external process changed.
