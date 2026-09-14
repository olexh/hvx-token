# HVX contract reference

Two contracts, both non-upgradeable, Solidity 0.8.28, OpenZeppelin Contracts 5.6.

| Contract | Reference | Purpose |
|---|---|---|
| `HVXToken` | [HVXToken.md](HVXToken.md) | HiveX (HVX) BEP-20 token, fixed 100B supply, burnable, EIP-2612 permit, no admin |
| `HVXVestingVault` | [HVXVestingVault.md](HVXVestingVault.md) | Holds locked allocations as immutable vesting schedules, owned by the foundation Safe |

Examples use **ethers.js v6**. Owner functions also show the **Safe Transaction Builder** fields, which is how the foundation multisig calls them on mainnet.

## Setup used by every example

```ts
import { ethers } from "ethers";
import tokenArtifact from "../artifacts/contracts/HVXToken.sol/HVXToken.json";
import vaultArtifact from "../artifacts/contracts/HVXVestingVault.sol/HVXVestingVault.json";
import deployment from "../deployments/bscTestnet.json"; // or bsc.json on mainnet

const provider = new ethers.JsonRpcProvider("https://bsc-testnet-rpc.publicnode.com", 97);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const token = new ethers.Contract(deployment.HVXToken, tokenArtifact.abi, wallet);
const vault = new ethers.Contract(deployment.HVXVestingVault, vaultArtifact.abi, wallet);

// helpers
const HVX = (n: string) => ethers.parseUnits(n, 18);      // "1000" -> 1000 HVX in wei
const fmt = (wei: bigint) => ethers.formatUnits(wei, 18); // wei -> "1000.0"
```

Amounts are always in **wei** (18 decimals): `1 HVX = 1_000_000_000_000_000_000`. Timestamps are Unix seconds. Durations are seconds. Basis points: `10000 = 100%`, `2500 = 25%`.

## Deployed addresses

| Network | Token | Vault | Treasury Safe |
|---|---|---|---|
| BSC testnet (97) | `0x73d2230A6060180864E360c1e641767019cAB027` | `0xc0A0C9F25526554b0c777124ADAC00Cc5aE2022a` | `0xcA05ac7C594E2D7D2a16b8aebe56763500760779` |
| BSC mainnet (56) | not deployed yet | | |

## Reading reverts

Both contracts use custom errors. With ethers v6 a failed `staticCall` or transaction exposes the decoded name:

```ts
try {
  await vault.release.staticCall(1n);
} catch (e: any) {
  console.log(e.reason ?? vault.interface.parseError(e.data)?.name); // "NothingToRelease"
}
```
