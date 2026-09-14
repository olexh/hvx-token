# HVX Token — BNB Smart Chain (BEP-20)

Fixed-supply utility / payment token plus a separate, non-upgradeable vesting vault.
Built on OpenZeppelin Contracts 5.x, Solidity 0.8.28, Hardhat 3.

| Contract | Purpose | Admin role |
|---|---|---|
| `HVXToken` | Standard BEP-20 (ERC-20) token `HiveX` (HVX), 100,000,000,000 supply, 18 decimals, burnable, EIP-2612 permit | **none** |
| `HVXVestingVault` | Holds every locked allocation as an on-chain vesting schedule | foundation multisig (minimal, see below) |

## 1. Architecture

```
                    deploy (one-off)
 Foundation Safe  ───────────────────►  HVXToken   (mints 100B HVX to Foundation Safe, then has NO admin)
 (Gnosis multisig)
        │  approve(vault) + createSchedule(...) ×N
        ▼
 HVXVestingVault  ──release(id)──►  Sales Safe / Foundation Safe / Liquidity Safe / Team wallets / Ecosystem / Marketing / Reserve
 (owner = Foundation Safe; owner may renounce once schedules are created)
```

Why two contracts: exchanges, wallets, crypto-card processors and auditors want the token to be a plain
ERC-20 with nothing unusual in `transfer` / `transferFrom`. All lock-up logic therefore lives in a separate
vault that simply *holds* HVX and pays it out on a schedule. The token never knows the vault exists.

### 1.1 `HVXToken`

* OpenZeppelin `ERC20` + `ERC20Burnable` + `ERC20Permit`. No custom transfer logic.
* Constructor mints the full `TOTAL_SUPPLY` (100,000,000,000 × 10¹⁸) to `treasury` and that is the only mint that
  can ever happen — there is no `mint` function, no owner, no proxy, no pause, no fees, no blacklist.
* `burn(amount)` — any holder burns its own tokens. `burnFrom(account, amount)` — burns only within an allowance
  the holder explicitly granted. The foundation can burn treasury tokens or tokens users voluntarily
  designated for burning, but can never burn arbitrary user balances.
* Staged burns (1st, 2nd, 3rd, …) are simply `burn` calls from the treasury Safe. Each emits
  `Transfer(treasury, 0x000…000, amount)`, which BscScan lists under the token's transfers and "burn" filter;
  `totalBurned()` returns the cumulative amount and `totalSupply()` the remaining supply.
* `permit` (EIP-2612) enables gasless approvals — useful for payment / card integrations.
* Name `HiveX`, symbol `HVX`, decimals `18`.

### 1.2 `HVXVestingVault`

One vault, many schedules. Each schedule is created once and can never be edited.

| Field | Meaning |
|---|---|
| `beneficiary` | Receives released tokens (use a dedicated multisig per allocation) |
| `label` | Human-readable allocation name (`"Team"`, `"Marketing"`, …) |
| `total` | HVX in the schedule |
| `start` | TGE / vesting start timestamp |
| `initialUnlockBps` | Share unlocked at `start`, in basis points (1000 = 10 %) |
| `cliffDuration` | Seconds after `start` with no further unlock |
| `vestingDuration` | Seconds of linear vesting after the cliff (`0` = remainder unlocks at cliff end) |
| `revocable` | Owner may revoke the **unvested** remainder (intended for individual team grants only) |
| `revokedAt` | `0` while active; after a revoke the unlock curve is frozen at this time, `total` keeps the original allocation |

Vesting curve: `0` before `start` → `initialUnlock` at `start` → flat until `start + cliff` → linear to `total`
at `start + cliff + vestingDuration`.

Examples:

* Liquidity, fully liquid at TGE: `initialUnlockBps = 10000, cliff = 0, vesting = 0`
* Team, 12-month cliff then 24-month linear: `initialUnlockBps = 0, cliff = 365d, vesting = 730d, revocable = true`
* Sales, 20 % at TGE then 6-month linear: `initialUnlockBps = 2000, cliff = 0, vesting = 180d`
* Reserve, hard lock for 2 years, then 100 %: `initialUnlockBps = 0, cliff = 730d, vesting = 0`

**Public, verifiable views** (per schedule id): `getSchedule`, `vestedAmount`, `vestedAmountAt(id, ts)`,
`releasableAmount`, `lockedAmount`, `releasedAmount`, `outstandingAmount`, `vestingEnd`, `schedulesOf(address)`,
`scheduleCount`, `totalCommitted`, `unallocated`. Historical queries (`vestedAmountAt`) stay correct after a
revoke: the original curve is evaluated up to `revokedAt` and frozen after it. Everything an exchange, auditor or community member needs is readable on BscScan.

**Permissionless**: `release(id)` can be called by anyone; tokens always go to the beneficiary.
`changeBeneficiary(id, newAddress)` can be called only by the current beneficiary (wallet rotation).

### 1.3 Administrator privileges (complete list)

`HVXToken`: none.

`HVXVestingVault` owner (foundation multisig, `Ownable2Step`):

| Function | What it can do | What it cannot do |
|---|---|---|
| `createSchedule` | Lock the owner's **own** HVX into a new schedule | Touch existing schedules |
| `revoke(id)` | Return the *unvested* part of a schedule flagged `revocable` at creation | Revoke non-revocable schedules; touch vested/released tokens |
| `withdrawUnallocated(to)` | Recover HVX sent to the vault by mistake (balance − committed) | Withdraw tokens backing any schedule |
| `recoverERC20(token,to,amt)` | Recover *other* tokens sent by mistake | Move HVX |
| `transferOwnership` / `renounceOwnership` | Hand over to a new multisig, or make the vault immutable | — |

No pause, no upgrade, no schedule edits, no redirecting payouts, no blacklist.
Recommended: once all allocations are created, call `renounceOwnership()` (or keep ownership only if new
schedules — e.g. future team grants — are expected).

## 2. Integration notes (crypto card / payment / exchanges)

* The token is a vanilla ERC-20: balances change only via `transfer` / `transferFrom` / `burn`. No transfer
  fees, no rebasing, no hooks, no max-tx / max-wallet limits, no trading toggles. `transfer` always moves the
  exact amount, which is what card processors and exchange deposit systems assume.
* `approve` / `transferFrom` and `permit` follow the OpenZeppelin reference implementation.
* Total supply is constant except for burns, so `totalSupply()` is a reliable circulating-supply upper bound;
  circulating supply = `totalSupply − vault.totalCommitted − treasury balances`.
* No proxy: the bytecode at the address never changes, which simplifies exchange technical reviews.
* Verified source, OpenZeppelin dependencies only, 100 % test coverage, fuzzed vesting invariants, clean Slither run.

## 3. Function reference

Every public function, parameter, revert and event of both contracts, with ethers.js v6 examples and Safe
Transaction Builder fields for owner calls: [docs/README.md](docs/README.md),
[docs/HVXToken.md](docs/HVXToken.md), [docs/HVXVestingVault.md](docs/HVXVestingVault.md).

## 4. Client demo page

`demo/index.html` is a standalone page that reads the deployed contracts live (supply, burns, treasury, every
vesting schedule with progress bars, Safe signers) and lets a connected MetaMask wallet transfer, burn and
release. No build step. `demo/CLIENT-GUIDE.md` is the handout for testers.

```bash
npx hardhat run scripts/demo-config.ts --network bscTestnet   # writes demo/config.js from deployments/
python3 -m http.server 4173 -d demo                           # or any static host (GitHub Pages, S3, …)
```

## 5. Repository layout

```
contracts/HVXToken.sol            token
contracts/HVXVestingVault.sol     vesting vault
test/*.test.ts                    Mocha/ethers unit tests (100 % line + statement coverage)
test/*.t.sol                      Solidity fuzz / property tests (forge-std, 1000 runs each)
scripts/deploy.ts                 deploy token + vault
scripts/schedules.ts              build Safe Transaction Builder batch (or send directly) from allocation config
scripts/status.ts                 print all schedules: locked / vested / released / releasable
scripts/release.ts                release one schedule (ID=n)
scripts/balance.ts                print deployer gas balance
scripts/safe-walkthrough.ts       testnet only: step-by-step demonstration of a 2-of-3 Safe execution
scripts/safe-create.ts            testnet only: deploy a Safe from local signer keys
scripts/safe-exec.ts              testnet only: sign + execute a Safe batch JSON with local signer keys
config/allocations.example.json   tokenomics template (PLACEHOLDER numbers)
deployments/<network>.json        written by deploy.ts
```

## 6. Setup

```bash
npm install
cp .env.example .env         # fill RPC URLs, deployer key, Etherscan API key
npm run compile
npm test                     # or: npx hardhat test --coverage
```

## 7. Deployment procedure (mainnet)

Prerequisites: a Gnosis Safe for the foundation treasury (`TREASURY`), ideally one Safe per allocation
as beneficiaries, and finalized tokenomics in `config/allocations.json` (copy the example file).

1. **Deploy** (deployer key only pays gas; it holds no privileges afterwards):
   ```bash
   TREASURY=0xFoundationSafe npx hardhat run scripts/deploy.ts --network bsc
   ```
   Addresses are written to `deployments/bsc.json`.
2. **Verify on BscScan** (commands are also printed by the deploy script):
   ```bash
   npx hardhat verify --network bsc <HVXToken> <TREASURY>
   npx hardhat verify --network bsc <HVXVestingVault> <HVXToken> <TREASURY>
   ```
3. **Create vesting schedules from the Safe**:
   ```bash
   CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bsc > safe-batch.json
   ```
   In the Safe web app: *Apps → Transaction Builder → Import* `safe-batch.json`, review every call
   (`approve` + one `createSchedule` per allocation), collect signatures, execute.
4. **Check**:
   ```bash
   npx hardhat run scripts/status.ts --network bsc
   ```
5. Optionally `renounceOwnership()` on the vault from the Safe once every allocation exists.

### Testnet rehearsal with a real Safe

```bash
# 1. generate local signer keys into .signers.bscTestnet.json (gitignored), fund the first one with tBNB
# 2. deploy a 2-of-3 Safe owned by them
THRESHOLD=2 npx hardhat run scripts/safe-create.ts --network bscTestnet
# 3. deploy token + vault with the Safe as treasury
TREASURY=<safe> npx hardhat run scripts/deploy.ts --network bscTestnet
# 4. build the batch, then sign with 2 signers and execute
CONFIG=config/allocations.testnet.json npx hardhat run scripts/schedules.ts --network bscTestnet > safe-batch.json
BATCH=safe-batch.json npx hardhat run scripts/safe-exec.ts --network bscTestnet
```

`safe-exec.ts` is a stand-in for the Safe web app. On mainnet the same `safe-batch.json` is imported in
*Transaction Builder* and signed by the real signers on their hardware wallets. Never generate mainnet signer
keys with a script.

## 8. Security considerations

* Solidity `0.8.28`, checked arithmetic, custom errors, CEI ordering, `SafeERC20`.
* The vault has no reentrancy vector with HVX (no transfer hooks) and follows checks-effects-interactions anyway.
* `createSchedule` validates `initialUnlockBps ≤ 10000` and that `start + cliff + vesting` fits `uint64`.
* Rounding in linear vesting favours the vault by at most 1 wei per computation; the final amount is exact.
* `revoke` records `revokedAt` and freezes the unlock curve there; `total` keeps the original allocation so
  historical `vestedAmountAt` queries and unlock charts stay correct. Released tokens are never affected.
* `createSchedule` and `changeBeneficiary` reject the vault and token addresses as beneficiaries, so released
  tokens can never be re-counted as unallocated.
* Independent review (2026-09-13) found no critical or high issues; its three findings (historical vesting
  queries after revoke, an incorrect `Approval` claim in the docs, a fuzz boundary assertion) are fixed.
* Static analysis: `npm run slither` (needs `uv tool install slither-analyzer solc-select`; `solc-select use 0.8.28`).
  Runs with `--fail-pedantic`; informational and optimization classes are excluded in `slither.config.json`,
  every other detector fails the run. The five reviewed `timestamp` / `incorrect-equality` occurrences in the
  vault (time comparisons are the purpose of vesting; `amount == 0` guards) are suppressed inline with
  `slither-disable` comments. Result: 0 findings on both contracts. `npm run check-erc20` confirms ERC-20 conformance.
* Recommended before mainnet: independent audit and a testnet rehearsal of the full Safe batch.

## 9. Open items before mainnet

* Final allocation amounts, beneficiaries and schedules (`config/allocations.json`).
* Foundation Safe address (`TREASURY`) and per-allocation Safes.
* Audit report and BscScan verification links for exchange applications.
