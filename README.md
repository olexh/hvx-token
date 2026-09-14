# HiveX (HVX)

BEP-20 token on BNB Smart Chain with a fixed supply of 100,000,000,000 HVX, plus a vesting vault for locked allocations.
Solidity 0.8.28, OpenZeppelin 5, Hardhat 3. No proxies, no upgrades.

| Contract | What it does | Admin |
|---|---|---|
| [`HVXToken`](contracts/HVXToken.sol) | Standard token. Minted once to the treasury. Burnable. EIP-2612 permit. | none |
| [`HVXVestingVault`](contracts/HVXVestingVault.sol) | Holds locked allocations as fixed schedules and pays them out over time. | foundation multisig, limited |

## How it works

1. The token is deployed with the foundation Safe as treasury. All 100B land there. Nothing can mint more.
2. The Safe locks each allocation (Sales, Foundation, Liquidity, Team, Ecosystem, Marketing, Reserve) into the vault
   as a schedule: beneficiary, amount, TGE unlock, cliff, linear vesting period, revocable flag.
3. Anyone can call `release(id)`; tokens always go to the schedule's beneficiary.
4. Staged burns are `burn` calls from the Safe. `totalBurned()` shows the running total.

The vault owner can only create schedules with its own tokens, revoke schedules marked revocable at creation
(the unvested part returns), and recover tokens that belong to no schedule. It cannot edit schedules, pause, or
touch anyone's balance. Ownership can be renounced once allocations are final.

Everything is readable on BscScan: per-schedule locked, vested, released and releasable amounts, plus vault totals.

## Quick start

```bash
npm install
cp .env.example .env      # RPC URLs, deployer key, Etherscan API key
npm test                  # 42 tests, fuzzing, 100 % coverage
npm run slither           # static analysis, expects 0 findings
```

## Deploy

```bash
TREASURY=0xFoundationSafe npx hardhat run scripts/deploy.ts --network bsc
npx hardhat verify --network bsc <token> <treasury>
npx hardhat verify --network bsc <vault> <token> <treasury>
CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bsc > safe-batch.json
```

Import `safe-batch.json` in the Safe web app (Transaction Builder), collect signatures, execute.
Full procedure, testnet rehearsal and script reference: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

- [docs/HVXToken.md](docs/HVXToken.md), [docs/HVXVestingVault.md](docs/HVXVestingVault.md): every function with parameters, reverts, events and ethers.js examples.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): mainnet procedure, testnet rehearsal, scripts.
- [demo/](demo/): standalone demo page for testers and a [client guide](demo/CLIENT-GUIDE.md).

## Testnet

| | Address |
|---|---|
| Token | `0x73d2230A6060180864E360c1e641767019cAB027` |
| Vault | `0xc0A0C9F25526554b0c777124ADAC00Cc5aE2022a` |
| Safe (2 of 3) | `0xcA05ac7C594E2D7D2a16b8aebe56763500760779` |

Both contracts are verified on [testnet.bscscan.com](https://testnet.bscscan.com/address/0x73d2230A6060180864E360c1e641767019cAB027#code).

## Security

- OpenZeppelin only, checked arithmetic, custom errors, checks-effects-interactions, SafeERC20.
- 42 tests including Solidity fuzz properties (1000 runs each), 100 % line and statement coverage.
- Slither clean under `--fail-pedantic`; the reviewed timestamp comparisons in the vault are suppressed inline.
- Independent review found no critical or high issues; all findings addressed.
- Before mainnet: final tokenomics, foundation Safe with hardware-wallet signers, external audit.
