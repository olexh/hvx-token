# HVXVestingVault

The vault holds HVX allocations and releases vested tokens to beneficiaries. Each schedule has a fixed allocation and vesting terms, but its beneficiary can transfer it to another address. The foundation Safe owns the vault through `Ownable2Step`.

See the [example setup](README.md#example-setup) for imports, contract instances and amount helpers. Owner functions also list Safe Transaction Builder fields.

## Schedule model

```solidity
struct Schedule {
    address beneficiary;      // receives released tokens
    string  label;            // "Team", "Marketing", ...
    uint256 total;            // original allocation in HVX base units, unchanged by revocation
    uint256 released;         // already released, in HVX base units
    uint64  start;            // initial unlock, Unix seconds
    uint64  cliffDuration;    // seconds after start with no further unlock
    uint64  vestingDuration;  // seconds of linear unlock after the cliff (0 = all at cliff end)
    uint64  revokedAt;        // 0 while active; time of revocation otherwise
    uint16  initialUnlockBps; // share unlocked at start, basis points (10000 = 100%)
    bool    revocable;        // owner may revoke the unvested part
    bool    revoked;
}
```

Vesting follows this curve, with `initialUnlock = total * initialUnlockBps / 10000`. Amounts are rounded down to whole base units.

| Time `t` | Vested |
|---|---|
| `t < start` | `0` |
| `start ≤ t < start + cliffDuration` | `initialUnlock` |
| `start + cliffDuration ≤ t < start + cliffDuration + vestingDuration` | `initialUnlock + (total − initialUnlock) × (t − start − cliffDuration) / vestingDuration` |
| `t ≥ start + cliffDuration + vestingDuration` | `total` |

When `vestingDuration` is zero, the remainder unlocks at the end of the cliff. An initial unlock remains claimable during the cliff.

After revocation, the curve is evaluated at `min(t, revokedAt)`. Queries for earlier timestamps preserve the vesting history; later timestamps return the amount vested at revocation.

Example schedules use fixed durations, not calendar months. TGE means the token generation event at the configured `start`.

| Allocation shape | `initialUnlockBps` | `cliffDuration` | `vestingDuration` |
|---|---|---|---|
| Liquid at TGE | `10000` | `0` | `0` |
| 20% at TGE, rest linear over 180 days | `2000` | `0` | `15552000` (180 days) |
| 365-day cliff, then 730-day linear vesting | `0` | `31536000` (365 days) | `63072000` (730 days) |
| Locked for 730 days, then fully vested | `0` | `63072000` (730 days) | `0` |
| 5% at TGE, 90-day cliff, 1,095-day linear vesting | `500` | `7776000` (90 days) | `94608000` (1,095 days) |

## Constructor

```solidity
constructor(IERC20 token_, address initialOwner)
```

| Parameter | Meaning |
|---|---|
| `token_` | HVX token address |
| `initialOwner` | Foundation Safe. Only it can create schedules. |

Reverts with `ZeroAddress()` for a zero token address or `OwnableInvalidOwner(0x0)` for a zero owner address.

## Owner functions

Only `owner()` can call these functions, except `acceptOwnership()`, which requires `pendingOwner()`. Unauthorized calls revert with `OwnableUnauthorizedAccount(caller)`.

### `createSchedule(address beneficiary, string label, uint256 total, uint64 start, uint64 cliffDuration, uint64 vestingDuration, uint16 initialUnlockBps, bool revocable) → uint256 id`

Creates a schedule and transfers `total` HVX from the owner into the vault. The owner must first approve the vault to spend at least `total`.

| Parameter | Meaning | Rules |
|---|---|---|
| `beneficiary` | Who receives the tokens | not `0x0`, not the vault, not the token |
| `label` | Name shown on explorers and events | any string |
| `total` | Allocation in HVX base units | `> 0` |
| `start` | Unix timestamp of the initial unlock | may be in the past |
| `cliffDuration` | Seconds after start before the remaining tokens begin vesting | must fit the end-time check below |
| `vestingDuration` | Seconds of linear vesting after the cliff; `0` unlocks the remainder at cliff end | must fit the end-time check below |
| `initialUnlockBps` | Basis points unlocked at `start` | `0..10000` |
| `revocable` | Owner may later call `revoke` | recommended `true` only for individual team grants |

Returns the new schedule `id`, starting at 0. Emits `ScheduleCreated(id, beneficiary, label, total, start, cliffDuration, vestingDuration, initialUnlockBps, revocable)`, then `Transfer(owner, vault, total)` on the token.

Invalid inputs revert with `ZeroAddress`, `InvalidBeneficiary`, `ZeroAmount` or `InvalidSchedule`. The end-time check requires `start + cliffDuration + vestingDuration` to fit in `uint64`; `initialUnlockBps` must not exceed `10000`. The token can also revert with `ERC20InsufficientAllowance` or `ERC20InsufficientBalance` when funding the schedule.

```ts
const DAY = 86400n;
const tge = 1798761600n; // 2027-01-01 00:00 UTC

await (await token.approve(vaultAddress, HVX("15000000000"))).wait();
const id = await vault.createSchedule.staticCall(
  "0xTeamSafe", "Team", HVX("15000000000"), tge, 365n * DAY, 730n * DAY, 0, true,
);
await (await vault.createSchedule("0xTeamSafe", "Team", HVX("15000000000"), tge, 365n * DAY, 730n * DAY, 0, true)).wait();
console.log("schedule id", id);
```

Safe Transaction Builder (two transactions in one batch):

1. Contract = **token**, method `approve`: `spender` = vault address, `value` = `15000000000000000000000000000`
2. Contract = **vault**, method `createSchedule`:
   `beneficiary` = `0xTeamSafe`, `label` = `Team`, `total` = `15000000000000000000000000000`, `start` = `1798761600`, `cliffDuration` = `31536000`, `vestingDuration` = `63072000`, `initialUnlockBps` = `0`, `revocable` = `true`

`scripts/schedules.ts` generates this batch from `config/allocations.json`.

### `revoke(uint256 id)`

Stops vesting for a schedule created with `revocable = true`. Vested tokens that have not been released remain claimable; the unvested remainder returns to the owner. Sets `revoked` and `revokedAt` without changing the original `total`.

| Parameter | Meaning |
|---|---|
| `id` | Schedule ID |

Emits `ScheduleRevoked(id, vestedTotal, refunded)` and, if `refunded > 0`, `Transfer(vault, owner, refunded)`.

Reverts with `UnknownSchedule(id)`, `NotRevocable()` or `AlreadyRevoked()`.

```ts
await (await vault.revoke(3n)).wait();
```

Safe: contract = vault, method `revoke`, `id` = `3`.

### `withdrawUnallocated(address to)`

Transfers all HVX not reserved for schedules to `to`. The amount is returned by `unallocated()`.

| Parameter | Meaning |
|---|---|
| `to` | Recipient, not `0x0` |

Emits `UnallocatedWithdrawn(to, amount)`. Reverts with `ZeroAddress()` for a zero recipient or `ZeroAmount()` when there is nothing to withdraw.

```ts
if ((await vault.unallocated()) > 0n) await (await vault.withdrawUnallocated(safeAddress)).wait();
```

Safe: contract = vault, method `withdrawUnallocated`, `to` = Safe address.

### `recoverERC20(address otherToken, address to, uint256 amount)`

Recovers ERC-20 tokens other than HVX that were sent to the vault by mistake.

| Parameter | Meaning |
|---|---|
| `otherToken` | Token contract, must not be HVX |
| `to` | Recipient, not `0x0` |
| `amount` | Amount in `otherToken` base units; use that token's decimals |

Reverts with `CannotRecoverVaultToken()` for HVX or `ZeroAddress()` for a zero recipient. Failed transfers can revert with `SafeERC20FailedOperation(token)` or an error from the other token.

```ts
await (await vault.recoverERC20("0xUSDT", safeAddress, ethers.parseUnits("100", 18))).wait();
```

### `transferOwnership(address newOwner)`

Starts an ownership transfer by setting `pendingOwner()` to `newOwner`. The current owner keeps its permissions until the new owner calls `acceptOwnership()`. Emits `OwnershipTransferStarted(owner, newOwner)`.

| Parameter | Meaning |
|---|---|
| `newOwner` | Proposed owner, e.g. a new Safe |

### `acceptOwnership()`

The pending owner calls this to accept ownership. Clears `pendingOwner()` and emits `OwnershipTransferred(old, new)`. Other callers receive `OwnableUnauthorizedAccount`.

```ts
// from the old Safe
await (await vault.transferOwnership("0xNewSafe")).wait();
// from the new Safe
await (await vault.connect(newSafeSigner).acceptOwnership()).wait();
```

### `renounceOwnership()`

Permanently sets `owner()` to `0x0`. Disables schedule creation, revocation, withdrawals and token recovery. `release` and `changeBeneficiary` remain available. Use after all allocations are funded if the foundation wants to give up these owner permissions. Emits `OwnershipTransferred(owner, 0x0)`.

Safe: contract = vault, method `renounceOwnership`, no parameters. This cannot be undone.

## Releases and beneficiary transfers

### `release(uint256 id)`

Transfers all vested, unreleased tokens to the schedule's beneficiary. Anyone may call, including the beneficiary. The caller receives the tokens only if they are the beneficiary.

| Parameter | Meaning |
|---|---|
| `id` | Schedule ID |

Emits `TokensReleased(id, beneficiary, amount)` and `Transfer(vault, beneficiary, amount)`. Reverts with `UnknownSchedule(id)` for an invalid ID or `NothingToRelease()` when `releasableAmount(id) == 0`.

```ts
const due = await vault.releasableAmount(0n);
if (due > 0n) await (await vault.release(0n)).wait();
```

Vested tokens remain claimable until released; there is no claim deadline.

### `changeBeneficiary(uint256 id, address newBeneficiary)`

The current beneficiary can transfer the schedule to another wallet or Safe. Only unreleased tokens are affected.

| Parameter | Meaning | Rules |
|---|---|---|
| `id` | Schedule ID | |
| `newBeneficiary` | New recipient | not `0x0`, not the vault, not the token, not the current beneficiary |

Emits `BeneficiaryChanged(id, previous, current)`. Reverts with `UnknownSchedule(id)` for an invalid ID, `NotBeneficiary()` for another caller, or `ZeroAddress()` or `InvalidBeneficiary()` for an invalid new beneficiary.

```ts
// signed by the current beneficiary
await (await vault.changeBeneficiary(4n, "0xNewWallet")).wait();
```

## Read functions

### `token() → address`

The HVX token this vault holds.

### `owner() → address`, `pendingOwner() → address`

The current vault owner and the proposed next owner. `owner()` is `0x0` after renunciation. `pendingOwner()` is `0x0` when no transfer is pending.

### `BPS_DENOMINATOR() → uint256`

`10000`. Basis-point scale for `initialUnlockBps`.

### `scheduleCount() → uint256`

Number of schedules. IDs run from `0` to `scheduleCount() - 1` when schedules exist.

### `getSchedule(uint256 id) → Schedule`

Returns the full `Schedule` struct described above. Reverts with `UnknownSchedule(id)` for an invalid ID.

```ts
const s = await vault.getSchedule(0n);
console.log(s.label, fmt(s.total), new Date(Number(s.start) * 1000).toISOString(), s.revoked);
```

### `schedulesOf(address beneficiary) → uint256[]`

IDs of schedules assigned to `beneficiary`. `changeBeneficiary` updates this list and may change its order.

### `vestedAmount(uint256 id) → uint256`

Tokens vested at the current block timestamp, including tokens already released. After revocation, this is the amount vested at `revokedAt`.

### `vestedAmountAt(uint256 id, uint64 timestamp) → uint256`

Evaluates the vesting curve at a Unix timestamp. Use it to query vesting history, preview a schedule or draw an unlock chart. Timestamps after revocation return the amount vested at `revokedAt`.

```ts
const s = await vault.getSchedule(3n);
for (let m = 0; m <= 36; m += 6) {
  const t = s.start + BigInt(m) * 30n * 86400n;
  console.log(`month ${m}:`, fmt(await vault.vestedAmountAt(3n, t)));
}
```

### `releasableAmount(uint256 id) → uint256`

`vestedAmount(id) - releasedAmount(id)`: the amount `release(id)` would pay at the current block timestamp.

### `lockedAmount(uint256 id) → uint256`

Unvested tokens in an active schedule: `total - vestedAmount(id)`. Returns `0` after full vesting. Also returns `0` after revocation, because the unvested tokens have been refunded.

### `outstandingAmount(uint256 id) → uint256`

Tokens still owed to the schedule: `total - released`, or `vestedAmountAt(id, revokedAt) - released` after revocation. Includes vested and unvested tokens, excluding releases and refunds.

### `releasedAmount(uint256 id) → uint256`

Tokens already released to the schedule's beneficiaries, including any previous beneficiary.

### `vestingEnd(uint256 id) → uint64`

`start + cliffDuration + vestingDuration`: the scheduled end timestamp. This value does not change after revocation, even though vesting has stopped.

### `totalCommitted() → uint256`

Sum of `outstandingAmount(id)` across all schedules. These tokens are reserved for beneficiaries. The vault maintains `token.balanceOf(vault) ≥ totalCommitted()`.

### `unallocated() → uint256`

HVX not reserved for schedules, such as tokens sent directly to the vault. Returns `token.balanceOf(vault) - totalCommitted()`, or `0` if the balance is lower. The owner can withdraw this amount.

Read all schedules:

```ts
const n = await vault.scheduleCount();
for (let i = 0n; i < n; i++) {
  const [s, vested, due, locked] = await Promise.all([
    vault.getSchedule(i), vault.vestedAmount(i), vault.releasableAmount(i), vault.lockedAmount(i),
  ]);
  console.log(`#${i} ${s.label}: total ${fmt(s.total)} vested ${fmt(vested)} releasable ${fmt(due)} locked ${fmt(locked)}`);
}
```

## Events

| Event | When |
|---|---|
| `ScheduleCreated(uint256 indexed id, address indexed beneficiary, string label, uint256 total, uint64 start, uint64 cliffDuration, uint64 vestingDuration, uint16 initialUnlockBps, bool revocable)` | `createSchedule` |
| `TokensReleased(uint256 indexed id, address indexed beneficiary, uint256 amount)` | `release` |
| `ScheduleRevoked(uint256 indexed id, uint256 vestedTotal, uint256 refunded)` | `revoke` |
| `BeneficiaryChanged(uint256 indexed id, address indexed previous, address indexed current)` | `changeBeneficiary` |
| `UnallocatedWithdrawn(address indexed to, uint256 amount)` | `withdrawUnallocated` |
| `OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)` | `transferOwnership` |
| `OwnershipTransferred(address indexed previousOwner, address indexed newOwner)` | `acceptOwnership`, `renounceOwnership`, constructor |

Full release history of one schedule:

```ts
const logs = await vault.queryFilter(vault.filters.TokensReleased(0n));
for (const l of logs) console.log(fmt(l.args.amount), "at block", l.blockNumber, l.transactionHash);
```

## Errors

| Error | Cause |
|---|---|
| `ZeroAddress()` | Zero token in constructor, zero beneficiary / recipient |
| `ZeroAmount()` | `total = 0`, or nothing to withdraw |
| `InvalidBeneficiary()` | Beneficiary is the vault, the token, or (on change) unchanged |
| `InvalidSchedule()` | `initialUnlockBps > 10000`, or time sum overflows `uint64` |
| `UnknownSchedule(id)` | `id ≥ scheduleCount()` |
| `NotBeneficiary()` | `changeBeneficiary` by someone else |
| `NotRevocable()` | `revoke` on a schedule created with `revocable = false` |
| `AlreadyRevoked()` | Second `revoke` |
| `NothingToRelease()` | `release` with `releasableAmount == 0` |
| `CannotRecoverVaultToken()` | `recoverERC20` with the HVX address |
| `OwnableUnauthorizedAccount(account)` | Owner-only or pending-owner-only function called by someone else |
| `OwnableInvalidOwner(owner)` | Zero owner in constructor |
| `SafeERC20FailedOperation(token)` | Token transfer returned false, or the token address has no code; token reverts may propagate their own errors |

## What the owner cannot do

The owner cannot change a schedule's allocation or vesting terms, pause or delay releases, redirect a beneficiary's payout, revoke a non-revocable schedule, take released tokens or mint HVX. It can reclaim committed tokens only by revoking a revocable schedule, and only the unvested portion is refunded.
