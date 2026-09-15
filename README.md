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

## Documentation

- [Contract reference](docs/README.md): token and vault functions, parameters, errors, events and ethers.js examples.
- [Demo](demo/): wallet transfers, burns and vesting releases on testnet.

## Testnet

| | Address |
|---|---|
| Token | `0xB92f8c1e40D83389c70Bb654F83a71B8f4979d69` |
| Vault | `0x414e9FA80ED96BA5181B7ab1aCeBFcA342C0C20C` |
| Safe (2 of 3) | `0x2D2A15e9c774166B8E2638dCbf989848e73c0F68` |

View the verified source on BscScan: [token](https://testnet.bscscan.com/address/0xB92f8c1e40D83389c70Bb654F83a71B8f4979d69#code)
and [vault](https://testnet.bscscan.com/address/0x414e9FA80ED96BA5181B7ab1aCeBFcA342C0C20C#code).

## Security

- The contracts use OpenZeppelin components, checked arithmetic, custom errors, checks-effects-interactions and `SafeERC20`.
- The test suite has 38 TypeScript tests and 4 Solidity fuzz tests with 1,000 runs each. Both contracts have 100% line and statement coverage.
- Slither reports no findings under `--fail-pedantic` with the repository configuration. Time-based vesting checks and related equality checks have inline suppressions.
