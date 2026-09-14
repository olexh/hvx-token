# HVXVestingVault

Holds locked HVX and pays it out on fixed schedules. One vault, many schedules. Each schedule is written once and can never be edited. Owner is the foundation Safe (`Ownable2Step`).

Setup for the snippets is in [README.md](README.md). Owner functions also show Safe Transaction Builder fields.

## Schedule model

```solidity
struct Schedule {
    address beneficiary;      // receives released tokens
    string  label;            // "Team", "Marketing", ...
    uint256 total;            // original allocation in wei, never changed
    uint256 released;         // already paid out (wei)
    uint64  start;            // TGE / unlock start, Unix seconds
    uint64  cliffDuration;    // seconds after start with no further unlock
    uint64  vestingDuration;  // seconds of linear unlock after the cliff (0 = all at cliff end)
    uint64  revokedAt;        // 0 while active; time of revocation otherwise
    uint16  initialUnlockBps; // share unlocked at start, basis points (10000 = 100%)
    bool    revocable;        // owner may revoke the unvested part
    bool    revoked;
}
```

Unlock curve, with `initial = total * initialUnlockBps / 10000`:

| Time `t` | Vested |
|---|---|
| `t < start` | `0` |
| `start ≤ t < start + cliff` | `initial` |
| `start + cliff ≤ t < start + cliff + vesting` | `initial + (total − initial) × (t − start − cliff) / vesting` |
| `t ≥ start + cliff + vesting` | `total` |

If the schedule was revoked, the curve is evaluated at `min(t, revokedAt)`. Queries for times before the revocation return what was vested back then; later times return the frozen value.

Recipes:

| Allocation shape | `initialUnlockBps` | `cliffDuration` | `vestingDuration` |
|---|---|---|---|
| Liquid at TGE | `10000` | `0` | `0` |
| 20% at TGE, rest linear 6 months | `2000` | `0` | `15552000` (180 d) |
| 12-month cliff, then 24-month linear | `0` | `31536000` | `63072000` |
| Hard lock 2 years, then 100% | `0` | `63072000` | `0` |
| 5% TGE, 3-month cliff, 36-month linear | `500` | `7776000` | `94608000` |

---

## Constructor

```solidity
constructor(IERC20 token_, address initialOwner)
```

| Param | Meaning |
|---|---|
| `token_` | HVX token address |
| `initialOwner` | Foundation Safe. Only it can create schedules. |

Reverts `ZeroAddress()` for a zero token, `OwnableInvalidOwner(0x0)` for a zero owner.

---

## Owner functions

Caller must be `owner()`. Anyone else gets `OwnableUnauthorizedAccount(caller)`.

### `createSchedule(address beneficiary, string label, uint256 total, uint64 start, uint64 cliffDuration, uint64 vestingDuration, uint16 initialUnlockBps, bool revocable) → uint256 id`

Creates a schedule and pulls `total` HVX from the owner into the vault. The owner must have approved the vault for at least `total` first.

| Param | Meaning | Rules |
|---|---|---|
| `beneficiary` | Who receives the tokens | not `0x0`, not the vault, not the token |
| `label` | Name shown on explorers and events | any string |
| `total` | HVX in wei | `> 0` |
| `start` | Unix seconds of the TGE unlock | may be in the past |
| `cliffDuration` | Seconds | any |
| `vestingDuration` | Seconds; `0` = remainder unlocks at cliff end | any |
| `initialUnlockBps` | Basis points unlocked at `start` | `0..10000` |
| `revocable` | Owner may later call `revoke` | recommended `true` only for individual team grants |

Returns the new `id` (sequential from 0). Emits `ScheduleCreated(id, beneficiary, label, total, start, cliffDuration, vestingDuration, initialUnlockBps, revocable)`, then `Transfer(owner, vault, total)` on the token.

Reverts: `ZeroAddress`, `InvalidBeneficiary`, `ZeroAmount`, `InvalidSchedule` (bps > 10000 or `start + cliff + vesting` overflows `uint64`), `ERC20InsufficientAllowance` / `ERC20InsufficientBalance` from the token.

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

Stops a schedule that was created with `revocable = true`. Tokens vested up to this block stay claimable by the beneficiary; the unvested remainder is transferred back to the owner. `revoked` and `revokedAt` are set; `total` keeps the original allocation. Nothing more ever vests.

| Param | Meaning |
|---|---|
| `id` | Schedule id |

Emits `ScheduleRevoked(id, vestedTotal, refunded)` and, if `refunded > 0`, `Transfer(vault, owner, refunded)`.

Reverts `UnknownSchedule(id)`, `NotRevocable()`, `AlreadyRevoked()`.

```ts
await (await vault.revoke(3n)).wait();
```

Safe: contract = vault, method `revoke`, `id` = `3`.

### `withdrawUnallocated(address to)`

Sends HVX that sits in the vault but backs no schedule (see `unallocated()`) to `to`. Cannot touch committed tokens.

| Param | Meaning |
|---|---|
| `to` | Recipient, not `0x0` |

Emits `UnallocatedWithdrawn(to, amount)`. Reverts `ZeroAddress()`, `ZeroAmount()` when there is nothing to withdraw.

```ts
if ((await vault.unallocated()) > 0n) await (await vault.withdrawUnallocated(safeAddress)).wait();
```

Safe: contract = vault, method `withdrawUnallocated`, `to` = Safe address.

### `recoverERC20(address otherToken, address to, uint256 amount)`

Returns some other ERC-20 that was sent to the vault by mistake.

| Param | Meaning |
|---|---|
| `otherToken` | Token contract, must not be HVX |
| `to` | Recipient, not `0x0` |
| `amount` | Wei of `otherToken` |

Reverts `CannotRecoverVaultToken()`, `ZeroAddress()`, `SafeERC20FailedOperation(token)` if the transfer fails.

```ts
await (await vault.recoverERC20("0xUSDT", safeAddress, ethers.parseUnits("100", 18))).wait();
```

### `transferOwnership(address newOwner)`

Starts a two-step handover. `newOwner` becomes `pendingOwner()`; nothing changes until they call `acceptOwnership`. Emits `OwnershipTransferStarted(owner, newOwner)`.

| Param | Meaning |
|---|---|
| `newOwner` | Proposed owner, e.g. a new Safe |

### `acceptOwnership()`

Called by `pendingOwner()`. Completes the handover, emits `OwnershipTransferred(old, new)`. Anyone else gets `OwnableUnauthorizedAccount`.

```ts
// from the old Safe
await (await vault.transferOwnership("0xNewSafe")).wait();
// from the new Safe
await (await vault.connect(newSafeSigner).acceptOwnership()).wait();
```

### `renounceOwnership()`

Sets `owner()` to `0x0` permanently. After this no schedule can be created or revoked and no stray tokens recovered; `release` and `changeBeneficiary` keep working forever. Use once all allocations exist and the foundation wants the vault provably immutable. Emits `OwnershipTransferred(owner, 0x0)`.

Safe: contract = vault, method `renounceOwnership`, no params. Irreversible.

---

## Permissionless functions

### `release(uint256 id)`

Pays everything vested and not yet released to the schedule's beneficiary. Anyone may call; the caller never receives tokens.

| Param | Meaning |
|---|---|
| `id` | Schedule id |

Emits `TokensReleased(id, beneficiary, amount)` and `Transfer(vault, beneficiary, amount)`. Reverts `UnknownSchedule(id)`, `NothingToRelease()` if `releasableAmount(id) == 0`.

```ts
const due = await vault.releasableAmount(0n);
if (due > 0n) await (await vault.release(0n)).wait();
```

A beneficiary can call this monthly, yearly or never; nothing is lost by waiting.

### `changeBeneficiary(uint256 id, address newBeneficiary)`

Lets the **current beneficiary** move its schedule to another address (wallet rotation, new Safe). Only unreleased tokens are affected.

| Param | Meaning | Rules |
|---|---|---|
| `id` | Schedule id | |
| `newBeneficiary` | New recipient | not `0x0`, not the vault, not the token, not the current beneficiary |

Emits `BeneficiaryChanged(id, previous, current)`. Reverts `NotBeneficiary()` when the caller is not the current beneficiary, `ZeroAddress()`, `InvalidBeneficiary()`.

```ts
// signed by the current beneficiary
await (await vault.changeBeneficiary(4n, "0xNewWallet")).wait();
```

---

## Read functions

### `token() → address`
The HVX token this vault holds.

### `owner() → address`, `pendingOwner() → address`
Current owner (foundation Safe, or `0x0` after renounce) and the address that may call `acceptOwnership`.

### `BPS_DENOMINATOR() → uint256`
`10000`. Basis-point scale for `initialUnlockBps`.

### `scheduleCount() → uint256`
Number of schedules. Ids run from `0` to `scheduleCount() - 1`.

### `getSchedule(uint256 id) → Schedule`
Full struct (fields above). Reverts `UnknownSchedule(id)`.

```ts
const s = await vault.getSchedule(0n);
console.log(s.label, fmt(s.total), new Date(Number(s.start) * 1000).toISOString(), s.revoked);
```

### `schedulesOf(address beneficiary) → uint256[]`
Ids whose current beneficiary is `beneficiary`. Kept up to date by `changeBeneficiary`.

### `vestedAmount(uint256 id) → uint256`
Unlocked so far at the current block time, released or not. For a revoked schedule this is the amount vested at `revokedAt`.

### `vestedAmountAt(uint256 id, uint64 timestamp) → uint256`
Same curve evaluated at an arbitrary Unix time. Use it to preview a schedule or to draw an unlock chart.

```ts
const s = await vault.getSchedule(3n);
for (let m = 0; m <= 36; m += 6) {
  const t = s.start + BigInt(m) * 30n * 86400n;
  console.log(`month ${m}:`, fmt(await vault.vestedAmountAt(3n, t)));
}
```

### `releasableAmount(uint256 id) → uint256`
`vestedAmount(id) - releasedAmount(id)`. What `release(id)` would pay right now.

### `lockedAmount(uint256 id) → uint256`
`total - vestedAmount(id)`. Still locked. `0` for fully vested schedules and for revoked ones (the unvested part went back to the owner).

### `outstandingAmount(uint256 id) → uint256`
What the vault still owes this schedule: `total - released`, or for a revoked schedule `vestedAmountAt(id, revokedAt) - released`. `totalCommitted()` is the sum of this over all schedules.

### `releasedAmount(uint256 id) → uint256`
Already paid to the beneficiary.

### `vestingEnd(uint256 id) → uint64`
`start + cliffDuration + vestingDuration`. Unix time at which the schedule is fully vested. Unchanged by a revoke.

### `totalCommitted() → uint256`
Sum of `outstandingAmount(id)` over all schedules: what the vault still owes. Invariant: `token.balanceOf(vault) ≥ totalCommitted()`.

### `unallocated() → uint256`
`token.balanceOf(vault) - totalCommitted()`, or `0`. HVX that arrived by direct transfer and belongs to no schedule. Only this can be withdrawn by the owner.

Dashboard snippet:

```ts
const n = await vault.scheduleCount();
for (let i = 0n; i < n; i++) {
  const [s, vested, due, locked] = await Promise.all([
    vault.getSchedule(i), vault.vestedAmount(i), vault.releasableAmount(i), vault.lockedAmount(i),
  ]);
  console.log(`#${i} ${s.label}: total ${fmt(s.total)} vested ${fmt(vested)} releasable ${fmt(due)} locked ${fmt(locked)}`);
}
```

---

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
| `SafeERC20FailedOperation(token)` | Underlying token transfer returned false / reverted |

## What the owner cannot do

Edit any field of an existing schedule, pause or delay releases, redirect a payout, revoke a non-revocable schedule, take released tokens, take committed tokens, mint. None of this is gated by a check; the functions simply do not exist.
