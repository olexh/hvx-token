# HVXToken

HiveX (HVX) is a BEP-20/ERC-20 token built from OpenZeppelin `ERC20`, `ERC20Burnable` and `ERC20Permit`. The full supply is minted at deployment. The contract has no owner, further minting, pause function, transfer fees or proxy.

```
name      HiveX
symbol    HVX
decimals  18
supply    100,000,000,000 HVX, minted once in the constructor
```

See the [example setup](README.md#example-setup) for imports, contract instances and amount helpers.

## Constructor

```solidity
constructor(address treasury)
```

| Parameter  | Meaning                                                     |
| ---------- | ----------------------------------------------------------- |
| `treasury` | Receives the full 100 billion HVX. Use the foundation Safe. |

Reverts with `ZeroAddress()` if `treasury` is the zero address (`0x0`).

```ts
const factory = new ethers.ContractFactory(
	tokenArtifact.abi,
	tokenArtifact.bytecode,
	wallet,
);
const token = await factory.deploy("0xFoundationSafe");
await token.waitForDeployment();
```

## Read functions

### `name() → string`

Returns `"HiveX"`.

### `symbol() → string`

Returns `"HVX"`.

### `decimals() → uint8`

Returns `18`.

### `TOTAL_SUPPLY() → uint256`

The amount minted at deployment: `100_000_000_000 * 10**18` base units. This constant does not decrease when tokens are burned.

### `totalSupply() → uint256`

Tokens currently in existence, including treasury and vault balances. Equals `TOTAL_SUPPLY - totalBurned()` and decreases with each burn.

### `totalBurned() → uint256`

Total tokens destroyed by `burn` and `burnFrom` since deployment, including treasury and other holders' burns.

```ts
console.log(fmt(await token.totalSupply()), "HVX total supply");
console.log(fmt(await token.totalBurned()), "HVX burned so far");
```

### `balanceOf(address account) → uint256`

| Parameter | Meaning     |
| --------- | ----------- |
| `account` | Any address |

```ts
const bal = await token.balanceOf("0xcd1FA94c98A63474CFcDF7464b174D2C7852AE65"); // HVX base units
```

### `allowance(address owner, address spender) → uint256`

| Parameter | Meaning                                         |
| --------- | ----------------------------------------------- |
| `owner`   | Token holder                                    |
| `spender` | Address allowed to spend on the holder's behalf |

Returns how much `spender` may still transfer or burn from `owner` through `transferFrom` or `burnFrom`.

### `nonces(address owner) → uint256`

The current permit nonce for `owner`, used when signing a permit. Each successful `permit` increments it by one.

### `DOMAIN_SEPARATOR() → bytes32`

The EIP-712 domain hash used by `permit`. Ethers.js computes this hash when signing typed data; other tools can read it here.

### `eip712Domain() → (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)`

EIP-5267 description of the permit domain. `name = "HiveX"`, `version = "1"`.

## Write functions

### `transfer(address to, uint256 value) → bool`

| Parameter | Meaning                       |
| --------- | ----------------------------- |
| `to`      | Recipient. Must not be `0x0`. |
| `value`   | Amount in HVX base units      |

Emits `Transfer(msg.sender, to, value)`. Reverts with `ERC20InsufficientBalance` if `value` exceeds the sender's balance, or `ERC20InvalidReceiver` if `to` is zero.

```ts
const tx = await token.transfer("0xRecipient", HVX("250"));
await tx.wait();
```

### `approve(address spender, uint256 value) → bool`

| Parameter | Meaning                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| `spender` | Address allowed to spend                                                      |
| `value`   | New allowance in HVX base units. Replaces the previous value; `0` revokes it. |

Emits `Approval(msg.sender, spender, value)`. A spender, such as the vault, a DEX router or a payment processor, needs an allowance before calling `transferFrom`. Set it with `approve` or `permit`.

```ts
await(await token.approve(vaultAddress, HVX("1000000"))).wait();
await(await token.approve(vaultAddress, ethers.MaxUint256)).wait(); // unlimited
```

### `transferFrom(address from, address to, uint256 value) → bool`

| Parameter | Meaning                        |
| --------- | ------------------------------ |
| `from`    | Holder who approved the caller |
| `to`      | Recipient                      |
| `value`   | Amount in HVX base units       |

Transfers tokens from `from` to `to` and reduces the caller's allowance by `value`. An allowance of `MaxUint256` is not reduced. Emits `Transfer(from, to, value)`. Reverts with `ERC20InsufficientAllowance(spender, allowance, needed)` or `ERC20InsufficientBalance` if the allowance or balance is too low.

```ts
// spender wallet
await(await token.transferFrom(holder, "0xRecipient", HVX("30"))).wait();
```

### `burn(uint256 value)`

| Parameter | Meaning                                                     |
| --------- | ----------------------------------------------------------- |
| `value`   | Amount of the caller's tokens to destroy, in HVX base units |

Permanently destroys the caller's tokens and emits `Transfer(msg.sender, 0x0, value)`. `totalSupply()` decreases and `totalBurned()` increases by `value`. Reverts with `ERC20InsufficientBalance` if the balance is too low.

This is the function the foundation Safe calls for staged burns.

```ts
await(await token.burn(HVX("5000000"))).wait();
```

Safe Transaction Builder: contract = token address, method `burn`, `value` = amount in HVX base units, e.g. `5000000000000000000000000` for 5,000,000 HVX.

### `burnFrom(address account, uint256 value)`

| Parameter | Meaning                        |
| --------- | ------------------------------ |
| `account` | Holder whose tokens are burned |
| `value`   | Amount in HVX base units       |

Burns tokens from `account` using the allowance it granted to the caller. Reverts with `ERC20InsufficientAllowance` if the allowance is below `value`. Burning another holder's tokens requires that holder's approval.

```ts
// holder first: await token.approve(foundation, HVX("100"))
// foundation then:
await(await token.burnFrom(holder, HVX("100"))).wait();
```

### `permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)`

Sets `allowance(owner, spender) = value` using an off-chain EIP-712 signature from `owner`. Anyone can submit the signature and pay the gas, so the owner does not need to send an approval transaction. A calling contract can combine a permit and payment in one transaction.

| Parameter     | Meaning                                             |
| ------------- | --------------------------------------------------- |
| `owner`       | Holder who signed                                   |
| `spender`     | Address receiving the allowance                     |
| `value`       | Allowance in HVX base units                         |
| `deadline`    | Unix timestamp after which the signature is invalid |
| `v`, `r`, `s` | Signature parts                                     |

Emits `Approval(owner, spender, value)` and increments `nonces(owner)`. Reverts with `ERC2612ExpiredSignature(deadline)` after the deadline, or `ERC2612InvalidSigner(signer, owner)` when the recovered signer does not match the owner. A wrong nonce, altered data or a replay can cause a signer mismatch.

```ts
const owner = wallet.address;
const spender = "0xPaymentContract";
const value = HVX("50");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const nonce = await token.nonces(owner);
const { chainId } = await provider.getNetwork();

const sig = ethers.Signature.from(
	await wallet.signTypedData(
		{
			name: "HiveX",
			version: "1",
			chainId,
			verifyingContract: await token.getAddress(),
		},
		{
			Permit: [
				{ name: "owner", type: "address" },
				{ name: "spender", type: "address" },
				{ name: "value", type: "uint256" },
				{ name: "nonce", type: "uint256" },
				{ name: "deadline", type: "uint256" },
			],
		},
		{ owner, spender, value, nonce, deadline },
	),
);

// any account may submit:
await(
	await token
		.connect(relayer)
		.permit(owner, spender, value, deadline, sig.v, sig.r, sig.s)
).wait();
```

## Events

| Event                                                                     | When                                                                                                                                                              |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Transfer(address indexed from, address indexed to, uint256 value)`       | Every transfer, the initial mint (`from = 0x0`) and every burn (`to = 0x0`).                                                                                      |
| `Approval(address indexed owner, address indexed spender, uint256 value)` | `approve` and `permit`. In OpenZeppelin 5, `transferFrom` and `burnFrom` reduce allowances without emitting this event. Read `allowance()` for the current value. |
| `EIP712DomainChanged()`                                                   | Defined by OpenZeppelin, never emitted here (domain is immutable)                                                                                                 |

Listing all burns:

```ts
const burns = await token.queryFilter(
	token.filters.Transfer(null, ethers.ZeroAddress),
);
for (const b of burns)
	console.log(b.args.from, fmt(b.args.value), b.transactionHash);
```

## Errors

| Error                                                    | Cause                                                                   |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ZeroAddress()`                                          | Constructor received `treasury = 0x0`                                   |
| `ERC20InsufficientBalance(sender, balance, needed)`      | Transfer or burn above balance                                          |
| `ERC20InsufficientAllowance(spender, allowance, needed)` | `transferFrom` or `burnFrom` exceeds the allowance                      |
| `ERC20InvalidReceiver(receiver)`                         | Transfer to `0x0`                                                       |
| `ERC20InvalidSender(sender)`                             | Zero source address in a transfer or burn                               |
| `ERC20InvalidApprover(approver)`                         | Zero address granting an allowance                                      |
| `ERC20InvalidSpender(spender)`                           | Zero spender in `approve` or `permit`                                   |
| `ERC2612ExpiredSignature(deadline)`                      | Permit after deadline                                                   |
| `ERC2612InvalidSigner(signer, owner)`                    | Permit signature does not match `owner` (bad data, wrong nonce, replay) |
| `InvalidAccountNonce(account, currentNonce)`             | Internal nonce guard, unreachable via `permit`                          |
| `ECDSAInvalidSignature*`                                 | Malformed `v`, `r`, `s`                                                 |
| `InvalidShortString()`, `StringTooLong(str)`             | OpenZeppelin string internals, unreachable                              |
