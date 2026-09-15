# Deployment

## Prerequisites

- Foundation Safe on BNB Smart Chain, preferably with a 3-of-5 threshold and hardware-wallet signers. Set `TREASURY` to its address.
- Final tokenomics in `config/allocations.json`, copied from `config/allocations.example.json`. Use whole HVX for amounts,
  days for durations, basis points for `initialUnlockBps` and Unix seconds for `start`, the token generation event (TGE).
- Deployer wallet funded for gas. About 0.05 BNB is the suggested starting balance; actual gas costs vary. The deployer receives no contract privileges when `TREASURY` is the foundation Safe.
- `.env` with `BSC_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`.

## Mainnet

1. Deploy the token and vault. The script writes their addresses to `deployments/bsc.json`.
   ```bash
   TREASURY=0xFoundationSafe npx hardhat run scripts/deploy.ts --network bsc
   ```
2. Verify the source on BscScan. The deployment script prints these commands with the deployed addresses.
   ```bash
   npx hardhat verify --network bsc <HVXToken> <TREASURY>
   npx hardhat verify --network bsc <HVXVestingVault> <HVXToken> <TREASURY>
   ```
3. Build the schedule batch.
   ```bash
   CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bsc > safe-batch.json
   ```
4. Import `safe-batch.json` into Safe Transaction Builder. Signers review the `approve` call and one
   `createSchedule` call per allocation, then sign and execute the batch.
5. Check each schedule and the vault totals.
   ```bash
   npx hardhat run scripts/status.ts --network bsc
   ```
6. Optionally call `renounceOwnership()` from the Safe after all allocations are funded. This permanently disables
   schedule creation, revocation, withdrawals and token recovery. Releases and beneficiary transfers remain available.

## Testnet rehearsal

Use the same flow on BSC testnet (chain ID 97), with a Safe owned by local test accounts. The scripts read existing
keys from `.signers.bscTestnet.json`; they do not generate them. Fund the deployer and first signer with tBNB for gas.
Use these local keys only for testnet. Never generate mainnet signer keys with a script.

Before running the on-chain tests, prepare `.demo-wallet.bscTestnet.json` with the demo wallet's address and private key,
fund it with test HVX and tBNB, and update the beneficiaries and start time in `config/allocations.testnet.json`.

```bash
# .signers.bscTestnet.json holds three test signer keys and is gitignored
THRESHOLD=2 npx hardhat run scripts/safe-create.ts --network bscTestnet
TREASURY=<safe> npx hardhat run scripts/deploy.ts --network bscTestnet
CONFIG=config/allocations.testnet.json npx hardhat run scripts/schedules.ts --network bscTestnet > safe-batch.json
BATCH=safe-batch.json npx hardhat run scripts/safe-exec.ts --network bscTestnet  # Sign and execute with local test keys
npx hardhat run scripts/onchain-test.ts --network bscTestnet                   # Send test transactions
npx hardhat run scripts/demo-config.ts --network bscTestnet                    # Update the demo configuration
```

Use `MODE=send` with `schedules.ts` to send transactions directly when the deployer is the vault owner. This mode submits transactions; it is not a simulation.

## Scripts

| Script | Purpose |
|---|---|
| `deploy.ts` | Deploy token and vault, write `deployments/<network>.json` |
| `schedules.ts` | Build a Safe Transaction Builder batch from the allocation config, or send transactions directly with `MODE=send` |
| `status.ts` | Print every schedule: locked, vested, released, releasable |
| `release.ts` | Release one schedule (`ID=n`) |
| `safe-create.ts` | Testnet: create a Safe from local signer keys |
| `safe-exec.ts` | Testnet: sign and execute a batch with N of M local signers |
| `onchain-test.ts` | Testnet: exercise token and vault functions, including calls from the Safe |
| `demo-config.ts` | Write `demo/config.js` from the current deployment |

## Staged burns

In Safe Transaction Builder, select the token address and method `burn`. Enter `value` in HVX base units
(`5000000000000000000000000` for 5,000,000 HVX). Each burn appears on BscScan as a transfer to the zero address.
`totalBurned()` returns the total burned by all holders, including the Safe.
