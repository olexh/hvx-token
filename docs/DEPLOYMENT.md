# Deployment

## Prerequisites

- Foundation Safe on BNB Smart Chain (recommended 3 of 5, hardware-wallet signers). Its address is `TREASURY`.
- Final tokenomics in `config/allocations.json` (copy `config/allocations.example.json`). Amounts in whole HVX,
  durations in days, `initialUnlockBps` in basis points, `start` as the TGE Unix timestamp.
- Deployer wallet with about 0.05 BNB. It only pays gas and holds no rights afterwards.
- `.env` with `BSC_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, `ETHERSCAN_API_KEY`.

## Mainnet

1. Deploy token and vault. Addresses are written to `deployments/bsc.json`.
   ```bash
   TREASURY=0xFoundationSafe npx hardhat run scripts/deploy.ts --network bsc
   ```
2. Verify source on BscScan (the deploy script prints these commands with the real addresses).
   ```bash
   npx hardhat verify --network bsc <HVXToken> <TREASURY>
   npx hardhat verify --network bsc <HVXVestingVault> <HVXToken> <TREASURY>
   ```
3. Build the schedule batch.
   ```bash
   CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bsc > safe-batch.json
   ```
4. In the Safe web app: Apps, Transaction Builder, Import `safe-batch.json`. Signers review each call
   (`approve` plus one `createSchedule` per allocation), sign, execute.
5. Check the result.
   ```bash
   npx hardhat run scripts/status.ts --network bsc
   ```
6. Optional: once every allocation exists and no further schedules are planned, the Safe calls
   `renounceOwnership()` on the vault. Releases keep working forever; nothing can be added or revoked afterwards.

## Testnet rehearsal

Same flow on chain 97, with a Safe created from local throwaway keys so the multisig path is exercised end to end.
Never generate mainnet signer keys with a script.

```bash
# .signers.bscTestnet.json holds three throwaway keys (gitignored); fund the first one with tBNB
THRESHOLD=2 npx hardhat run scripts/safe-create.ts --network bscTestnet
TREASURY=<safe> npx hardhat run scripts/deploy.ts --network bscTestnet
CONFIG=config/allocations.testnet.json npx hardhat run scripts/schedules.ts --network bscTestnet > safe-batch.json
BATCH=safe-batch.json npx hardhat run scripts/safe-exec.ts --network bscTestnet   # stand-in for the Safe web app
npx hardhat run scripts/onchain-test.ts --network bscTestnet                        # every function, live
npx hardhat run scripts/demo-config.ts --network bscTestnet                         # point the demo page at it
```

`MODE=send` on `schedules.ts` skips the Safe entirely when the deployer is the vault owner (quick dry runs).

## Scripts

| Script | Purpose |
|---|---|
| `deploy.ts` | Deploy token and vault, write `deployments/<network>.json` |
| `schedules.ts` | Allocation config to Safe Transaction Builder batch, or send directly (`MODE=send`) |
| `status.ts` | Print every schedule: locked, vested, released, releasable |
| `release.ts` | Release one schedule (`ID=n`) |
| `balance.ts` | Deployer gas balance |
| `safe-create.ts` | Testnet: create a Safe from local signer keys |
| `safe-exec.ts` | Testnet: sign and execute a batch with N of M local signers |
| `safe-walkthrough.ts` | Testnet: step-by-step demonstration of the signature threshold |
| `onchain-test.ts` | Testnet: live test of every contract function including Safe-owner paths |
| `demo-config.ts` | Write `demo/config.js` from the current deployment |

## Staged burns

From the Safe: Transaction Builder, token address, method `burn`, `value` in wei
(`5000000000000000000000000` for 5,000,000 HVX). Each burn appears on BscScan as a transfer to the zero address;
`totalBurned()` on the token returns the running total.
