# HiveX (HVX)

BEP-20 token on BNB Smart Chain with an initial supply of 100,000,000,000 HVX and a vesting vault for locked allocations.
Built with Solidity 0.8.28, OpenZeppelin Contracts 5.6 and Hardhat 3. Both contracts are non-upgradeable and use no proxies.

| Contract | What it does | Admin |
|---|---|---|
| [`HVXToken`](contracts/HVXToken.sol) | Mints the initial supply to the treasury. Supports burns and EIP-2612 permit approvals. | None |
| [`HVXVestingVault`](contracts/HVXVestingVault.sol) | Holds allocations and releases vested tokens to beneficiaries. | Foundation Safe |

## How it works

1. Deploy the token with the foundation Safe as treasury. It receives all 100 billion HVX; no more can be minted.
2. The Safe funds each allocation (Sales, Foundation, Liquidity, Team, Ecosystem, Marketing, Reserve) in the vault.
   Each schedule defines a beneficiary, amount, initial unlock at the token generation event (TGE), cliff,
   linear vesting period and whether it can be revoked.
3. Anyone can call `release(id)`; tokens always go to the schedule's beneficiary.
4. The Safe calls `burn` for staged treasury burns. In Safe Transaction Builder, enter `value` in base units
   (`5000000000000000000000000` for 5,000,000 HVX). `totalBurned()` counts all burns, including those by other holders.

The vault owner can fund new schedules, revoke schedules marked revocable and recover tokens not reserved for schedules.
Revocation refunds only unvested tokens. Schedule amounts and vesting terms are fixed; only the current beneficiary
can transfer a schedule to another address. The owner cannot pause releases or take tokens from beneficiaries' wallets.
Vault ownership can be transferred in two steps or renounced permanently.

Read each schedule's locked, vested, released and releasable amounts, along with vault totals, on BscScan.

## Quick start

```bash
npm install
cp .env.example .env      # Set RPC URLs, deployer key and Etherscan API key
npm test                 # Unit and fuzz tests
npm run coverage         # Line and statement coverage
npm run slither          # Requires Slither and solc 0.8.28 on PATH
```

## Deploy

Prerequisites: a foundation Safe on BNB Smart Chain (its address becomes `TREASURY`), `config/allocations.json`
copied from `config/allocations.example.json` with the final allocations (whole HVX for amounts, days for durations,
basis points for `initialUnlockBps`, Unix seconds for `start`), a deployer wallet funded for gas, and `.env` with
`BSC_RPC_URL`, `DEPLOYER_PRIVATE_KEY` and `ETHERSCAN_API_KEY`. The deployer holds no contract privileges after deployment.

```bash
TREASURY=0xFoundationSafe npx hardhat run scripts/deploy.ts --network bsc   # Writes deployments/bsc.json
npx hardhat verify --network bsc <token> <treasury>
npx hardhat verify --network bsc <vault> <token> <treasury>
CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bsc > safe-batch.json
```

Import `safe-batch.json` into Safe Transaction Builder. Signers review the `approve` call and one `createSchedule`
call per allocation, then sign and execute the batch. Check the result with `npx hardhat run scripts/status.ts --network bsc`.
Optionally call `renounceOwnership()` from the Safe once all allocations are funded. This permanently disables
schedule creation, revocation, withdrawals and token recovery; releases and beneficiary transfers remain available.

### Testnet rehearsal

Same flow on BSC testnet (chain ID 97) with a Safe owned by local test accounts. The scripts read existing keys from
the gitignored `.signers.bscTestnet.json` and `.demo-wallet.bscTestnet.json`; they do not generate them. Fund the
deployer, the first signer and the demo wallet with tBNB, and update the beneficiaries and start time in
`config/allocations.testnet.json`. Use these local keys only for testnet.

```bash
THRESHOLD=2 npx hardhat run scripts/safe-create.ts --network bscTestnet
TREASURY=<safe> npx hardhat run scripts/deploy.ts --network bscTestnet
CONFIG=config/allocations.testnet.json npx hardhat run scripts/schedules.ts --network bscTestnet > safe-batch.json
BATCH=safe-batch.json npx hardhat run scripts/safe-exec.ts --network bscTestnet  # Sign and execute with local test keys
npx hardhat run scripts/onchain-test.ts --network bscTestnet                   # Send test transactions
npx hardhat run scripts/demo-config.ts --network bscTestnet                    # Update the demo configuration
```

`MODE=send` makes `schedules.ts` send the transactions directly when the deployer is the vault owner. It submits real transactions; it is not a simulation.

### Scripts

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

## Documentation

- [Contract reference](docs/README.md): token and vault functions, parameters, errors, events and ethers.js examples.
- [Demo](demo/): wallet transfers, burns and vesting releases on testnet.

## Testnet

| | Address |
|---|---|
| Token | `0x73d2230A6060180864E360c1e641767019cAB027` |
| Vault | `0xc0A0C9F25526554b0c777124ADAC00Cc5aE2022a` |
| Safe (2 of 3) | `0xcA05ac7C594E2D7D2a16b8aebe56763500760779` |

View the verified source on BscScan: [token](https://testnet.bscscan.com/address/0x73d2230A6060180864E360c1e641767019cAB027#code)
and [vault](https://testnet.bscscan.com/address/0xc0A0C9F25526554b0c777124ADAC00Cc5aE2022a#code).

## Security

- The contracts use OpenZeppelin components, checked arithmetic, custom errors, checks-effects-interactions and `SafeERC20`.
- The test suite has 38 TypeScript tests and 4 Solidity fuzz tests with 1,000 runs each. Both contracts have 100% line and statement coverage.
- Slither reports no findings under `--fail-pedantic` with the repository configuration. Time-based vesting checks and related equality checks have inline suppressions.
- Before mainnet deployment, finalize tokenomics, set up the foundation Safe with hardware-wallet signers and obtain an external audit.
