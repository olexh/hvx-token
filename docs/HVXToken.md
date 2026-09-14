# HVXToken

HiveX (HVX). Standard BEP-20 / ERC-20 built from OpenZeppelin `ERC20`, `ERC20Burnable`, `ERC20Permit`. No owner, no mint, no pause, no fees, no proxy.

```
name      HiveX
symbol    HVX
decimals  18
supply    100,000,000,000 HVX, minted once in the constructor
```

Setup for the snippets is in [README.md](README.md).

---

## Constructor

```solidity
constructor(address treasury)
```

| Param | Meaning |
|---|---|
| `treasury` | Receives the full 100B supply. Use the foundation Safe. |

Reverts `ZeroAddress()` if `treasury` is `0x0`. Runs once at deployment; there is no way to mint afterwards.

```ts
const factory = new ethers.ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, wallet);
const token = await factory.deploy("0xFoundationSafe");
await token.waitForDeployment();
```

---

## Read functions

### `name() → string`
Returns `"HiveX"`.

### `symbol() → string`
Returns `"HVX"`.

### `decimals() → uint8`
Returns `18`.

### `TOTAL_SUPPLY() → uint256`
Constant. The amount minted at deployment: `100_000_000_000 * 10**18`. Never changes.

### `totalSupply() → uint256`
Tokens currently in existence. Equals `TOTAL_SUPPLY - totalBurned()`. Goes down with every burn, never up.

### `totalBurned() → uint256`
Cumulative amount destroyed by `burn` and `burnFrom` since deployment. Use this to report staged burns.

```ts
console.log(fmt(await token.totalSupply()), "HVX in circulation");
console.log(fmt(await token.totalBurned()), "HVX burned so far");
```

### `balanceOf(address account) → uint256`

| Param | Meaning |
|---|---|
| `account` | Any address |

```ts
const bal = await token.balanceOf("0x403ac79402fB55Af1090CF0EBe88bA1d9Cfe8fAe"); // wei
```

### `allowance(address owner, address spender) → uint256`

| Param | Meaning |
|---|---|
| `owner` | Token holder |
| `spender` | Address allowed to spend on the holder's behalf |

Returns how much `spender` may still move out of `owner` via `transferFrom` / `burnFrom`.

### `nonces(address owner) → uint256`
Current permit nonce for `owner`. Each successful `permit` increments it by one. Needed to build a permit signature.

### `DOMAIN_SEPARATOR() → bytes32`
EIP-712 domain hash used by `permit`. Ethers computes it for you; exposed for other tooling.

### `eip712Domain() → (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`
EIP-5267 description of the permit domain. `name = "HiveX"`, `version = "1"`.

---

## Write functions

### `transfer(address to, uint256 value) → bool`

| Param | Meaning |
|---|---|
| `to` | Recipient. Must not be `0x0`. |
| `value` | Amount in wei |

Emits `Transfer(msg.sender, to, value)`. Reverts `ERC20InsufficientBalance` if `value` exceeds the sender's balance, `ERC20InvalidReceiver` if `to` is zero.

```ts
const tx = await token.transfer("0xRecipient", HVX("250"));
await tx.wait();
```

### `approve(address spender, uint256 value) → bool`

| Param | Meaning |
|---|---|
| `spender` | Address allowed to spend |
| `value` | New allowance in wei. Replaces the previous value; `0` revokes. |

Emits `Approval(msg.sender, spender, value)`. Required before a contract (the vesting vault, a DEX router, a payment processor) can pull tokens with `transferFrom`.

```ts
await (await token.approve(vaultAddress, HVX("1000000"))).wait();
await (await token.approve(vaultAddress, ethers.MaxUint256)).wait(); // unlimited
```

### `transferFrom(address from, address to, uint256 value) → bool`

| Param | Meaning |
|---|---|
| `from` | Holder who approved the caller |
| `to` | Recipient |
| `value` | Amount in wei |

Moves tokens on behalf of `from` and reduces the allowance by `value` (an allowance of `MaxUint256` is not reduced). Emits `Transfer(from, to, value)`. Reverts `ERC20InsufficientAllowance(spender, allowance, needed)` or `ERC20InsufficientBalance`.

```ts
// spender wallet
await (await token.transferFrom(holder, "0xRecipient", HVX("30"))).wait();
```

### `burn(uint256 value)`

| Param | Meaning |
|---|---|
| `value` | Amount of the caller's own tokens to destroy, in wei |

Emits `Transfer(msg.sender, 0x0, value)`. `totalSupply` decreases, `totalBurned` increases. Reverts `ERC20InsufficientBalance`. Irreversible.

This is the function the foundation Safe calls for staged burns.

```ts
await (await token.burn(HVX("5000000"))).wait();
```

Safe Transaction Builder: contract = token address, method `burn`, `value` = amount in wei, e.g. `5000000000000000000000000` for 5,000,000 HVX.

### `burnFrom(address account, uint256 value)`

| Param | Meaning |
|---|---|
| `account` | Holder whose tokens are burned |
| `value` | Amount in wei |

Same as `burn` but spends the caller's allowance from `account`. Reverts `ERC20InsufficientAllowance` if `account` has not approved the caller for at least `value`. This is the only way to burn another address's tokens and it requires that address's explicit consent.

```ts
// holder first: await token.approve(foundation, HVX("100"))
// foundation then:
await (await token.burnFrom(holder, HVX("100"))).wait();
```

### `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`

Sets `allowance(owner, spender) = value` using an off-chain EIP-712 signature from `owner` instead of an `approve` transaction. Anyone can submit it and pay the gas. Used for gasless onboarding and one-transaction "approve and pay" flows.

| Param | Meaning |
|---|---|
| `owner` | Holder who signed |
| `spender` | Address receiving the allowance |
| `value` | Allowance in wei |
| `deadline` | Unix time after which the signature is invalid |
| `v`, `r`, `s` | Signature parts |

Emits `Approval(owner, spender, value)` and consumes `nonces(owner)`. Reverts `ERC2612ExpiredSignature(deadline)` if past the deadline, `ERC2612InvalidSigner(signer, owner)` if the signature does not match (wrong nonce, wrong data, replay).

```ts
const owner = wallet.address;
const spender = "0xPaymentContract";
const value = HVX("50");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = await token.nonces(owner);
const { chainId } = await provider.getNetwork();

const sig = ethers.Signature.from(await wallet.signTypedData(
  { name: "HiveX", version: "1", chainId, verifyingContract: await token.getAddress() },
  { Permit: [
    { name: "owner", type: "address" }, { name: "spender", type: "address" },
    { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  ] },
  { owner, spender, value, nonce, deadline },
));

// any account may submit:
await (await token.connect(relayer).permit(owner, spender, value, deadline, sig.v, sig.r, sig.s)).wait();
```

---

## Events

| Event | When |
|---|---|
| `Transfer(address indexed from, address indexed to, uint256 value)` | Every transfer. `from = 0x0` only once (the mint). `to = 0x0` for burns. |
| `Approval(address indexed owner, address indexed spender, uint256 value)` | `approve` and `permit` only. `transferFrom` / `burnFrom` reduce the allowance **without** emitting `Approval` (OpenZeppelin 5 behaviour), so read `allowance()` instead of caching it from events. |
| `EIP712DomainChanged()` | Defined by OpenZeppelin, never emitted here (domain is immutable) |

Listing all burns:

```ts
const burns = await token.queryFilter(token.filters.Transfer(null, ethers.ZeroAddress));
for (const b of burns) console.log(b.args.from, fmt(b.args.value), b.transactionHash);
```

## Errors

| Error | Cause |
|---|---|
| `ZeroAddress()` | Constructor got `treasury = 0x0` |
| `ERC20InsufficientBalance(sender, balance, needed)` | Transfer or burn above balance |
| `ERC20InsufficientAllowance(spender, allowance, needed)` | `transferFrom` / `burnFrom` above allowance |
| `ERC20InvalidReceiver(receiver)` | Transfer to `0x0` |
| `ERC20InvalidSender(sender)`, `ERC20InvalidApprover(approver)`, `ERC20InvalidSpender(spender)` | Zero address in the respective role (unreachable through the public API except approve to `0x0`) |
| `ERC2612ExpiredSignature(deadline)` | Permit after deadline |
| `ERC2612InvalidSigner(signer, owner)` | Permit signature does not match `owner` (bad data, wrong nonce, replay) |
| `InvalidAccountNonce(account, currentNonce)` | Internal nonce guard, unreachable via `permit` |
| `ECDSAInvalidSignature*` | Malformed `v`, `r`, `s` |
| `InvalidShortString()`, `StringTooLong(str)` | OpenZeppelin string internals, unreachable |

## What is deliberately absent

No `mint`, `owner`, `pause`, `blacklist`, `setFee`, `upgradeTo`, `increaseAllowance`/`decreaseAllowance` (removed in OpenZeppelin 5; use `approve`). Balances can only change through the functions above, each initiated by the holder or an address the holder approved.
