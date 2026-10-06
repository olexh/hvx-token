# Block deal schedules

Each block deal buyer gets their own schedule in the HVX Vesting Vault. The allocation is held in the vault and
cannot be claimed before the buyer's unlock date. From that date the buyer claims according to the vesting terms,
and tokens always go to the buyer's wallet.

Buyer schedules are created as non-revocable. Once a schedule exists, nobody can change its amount, dates or
vesting terms, including the Foundation. The Foundation cannot release tokens early, pause claims or take the tokens back.

Only the vault owner, the Foundation Safe, can create schedules. Use the [HVX Block Deals](../demo/safe/) Safe App,
or follow the manual Transaction Builder steps below.

## Addresses (BNB Smart Chain)

| | Address |
|---|---|
| HVX token | `0x252Ce29d2a58B70f98fe80a67773747770Bb0028` |
| Vesting vault | `0x04d4D102eed59b34A1A6527b48cCa690daEeC8a3` |
| Foundation Safe | `0xc5748294eE8884E7ac0bf27E0978cBA4c81b6d75` |

## How a buyer schedule is set up

The lock-up is the schedule `start`: the unlock date. Nothing vests before it.

| Field | Meaning |
|---|---|
| `beneficiary` | Buyer's wallet. Tokens can only be claimed to this address. |
| `label` | Name for reference, e.g. `Block deal - Buyer A`. |
| `total` | Allocation in base units: the HVX amount followed by 18 zeros. |
| `start` | Unlock date as a Unix timestamp in seconds (UTC). |
| `cliffDuration` | Extra wait after the unlock date before gradual release, in seconds. Usually `0`. |
| `vestingDuration` | Length of the gradual release after the cliff, in seconds. `0` releases everything at once. |
| `initialUnlockBps` | Share claimable on the unlock date, in basis points (`10000` = 100%). |
| `revocable` | Always `false` for buyers. |

Examples:

| Terms | `start` | `cliffDuration` | `vestingDuration` | `initialUnlockBps` |
|---|---|---|---|---|
| 12-month lock-up, everything at unlock | deal date + 12 months | `0` | `0` | `10000` |
| 6-month lock-up, 20% at unlock, rest over 12 months | deal date + 6 months | `0` | `31536000` | `2000` |
| 6-month lock-up, nothing at unlock, rest over 12 months after a further 3 months | deal date + 6 months | `7776000` | `31536000` | `0` |

Useful durations: 30 days = `2592000`, 90 days = `7776000`, 182 days = `15724800`, 365 days = `31536000`.
Gradual release is continuous: tokens unlock every second, not in monthly steps.

## Option 1: HVX Block Deals Safe App

The app fills in all base-unit values from a form, checks the input and the Safe balance, and shows a plain-English
summary before anything is signed.

1. Send the buyers' HVX to the Foundation Safe.
2. In the Safe at app.safe.global, open Apps → My custom apps → Add custom Safe App and paste
   `https://olexh.github.io/hvx-token/safe/`. This is needed only once.
3. Open HVX Block Deals in the Safe and enter each buyer's name, wallet, HVX amount, unlock date and vesting.
4. Check the summary, tick the confirmation and press **Send to Safe for signing**. Sign in the Safe's review screen.
5. A second signer confirms and executes the transaction in the Safe queue.

## Option 2: Safe Transaction Builder (manual)

### Step 1: Fund the Safe

Send the buyer's allocation from the wallet that holds the HVX to the Foundation Safe.

### Step 2: Open Transaction Builder

1. Go to app.safe.global and connect a signer wallet.
2. Select the Foundation Safe on BNB Chain.
3. Open Apps → Transaction Builder.

### Step 3: Add the approval

The approval lets the vault take the HVX from the Safe.

1. In "Enter Address or ENS Name", enter the HVX token address `0x252Ce29d2a58B70f98fe80a67773747770Bb0028`.
   The contract functions should load automatically. If they don't, copy the ABI from the token's "Contract" tab on
   BscScan and paste it into the ABI field.
2. Under "Transaction information", check that **To Address** is the HVX token address. Enter it if it's empty.
3. In "Contract Method Selector", choose `approve`.
4. Fill in:
   - `spender`: the vesting vault address `0x04d4D102eed59b34A1A6527b48cCa690daEeC8a3`
   - `value`: the allocation in base units. 100,000,000 HVX = `100000000000000000000000000`
5. Click "Add transaction".

### Step 4: Add the schedule

1. In "Enter Address or ENS Name", enter the vesting vault address `0x04d4D102eed59b34A1A6527b48cCa690daEeC8a3`.
   If the functions don't load, paste the ABI from the vault's "Contract" tab on BscScan.
2. Under "Transaction information", check that **To Address** is the vesting vault address. Enter it if it's empty.
3. In "Contract Method Selector", choose `createSchedule`.
4. Fill in the fields. Example for Buyer A, 100,000,000 HVX with a 12-month lock-up and everything at unlock:

   | Field | Value |
   |---|---|
   | `beneficiary` | buyer's wallet address |
   | `label` | `Block deal - Buyer A` |
   | `total` | `100000000000000000000000000` (same as `value` in Step 3) |
   | `start` | unlock date as a Unix timestamp, e.g. `1822780800` = 6 Oct 2027, 00:00 UTC (epochconverter.com) |
   | `cliffDuration` | `0` |
   | `vestingDuration` | `0` |
   | `initialUnlockBps` | `10000` |
   | `revocable` | `false` |

5. Click "Add transaction".

For several buyers, add one `approve` for the combined total, then one `createSchedule` per buyer, all in the same batch.

### Step 5: Sign and execute

1. Check that the batch contains `approve` on the token first, then `createSchedule` on the vault.
2. Click "Create batch", then "Send batch". Check that the simulation succeeds, then sign.
3. A second signer opens the Safe, reviews the transaction in the queue, and confirms and executes it.
4. On execution, the HVX moves from the Safe into the vault and is locked.

Before signing, double-check:

- the wallet address
- the amount, including the number of zeros
- the unlock timestamp
- `revocable` = `false`

A schedule can't be changed or cancelled after execution.

## Check the result

On BscScan, open the vault → Contract → Read Contract:

- `schedulesOf(buyer wallet)` returns the buyer's schedule IDs.
- `getSchedule(id)` shows all the terms.
- `lockedAmount(id)` and `releasableAmount(id)` show the current status.

## Claiming after the unlock date

Anyone can call `release(id)`, on BscScan (Write Contract) or on the HVX dashboard. The tokens always go to the
buyer's wallet. Before the unlock date the call fails with `NothingToRelease`.

## Note

The current beneficiary can move a schedule to another wallet with `changeBeneficiary`. The locked tokens stay
locked under the same terms. If a deal must forbid this, put it in the buyer agreement.
