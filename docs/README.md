# HVX contract reference

Both contracts use Solidity 0.8.28 and OpenZeppelin Contracts 5.6. Neither is upgradeable.

| Contract | Reference | Purpose |
|---|---|---|
| `HVXToken` | [HVXToken.md](HVXToken.md) | BEP-20 token with an initial supply of 100 billion HVX, burns, EIP-2612 permit approvals and no admin |
| `HVXVestingVault` | [HVXVestingVault.md](HVXVestingVault.md) | Holds allocations with fixed vesting terms; the foundation Safe owns the vault |

Examples use ethers.js v6. The foundation Safe calls owner functions through Safe Transaction Builder; the reference lists the required fields.

## Example setup

Run `npm run compile` to generate the contract artifacts. Set `PRIVATE_KEY` for the example wallet and replace placeholder addresses such as `0xRecipient` with real addresses. Owner calls must come from the vault owner; a Safe uses the Transaction Builder fields rather than a single wallet signature.

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
const HVX = (n: string) => ethers.parseUnits(n, 18);      // "1000" -> 1000 HVX in base units
const fmt = (wei: bigint) => ethers.formatUnits(wei, 18); // base units -> "1000.0"
```

Contract amounts use HVX base units with 18 decimals: `1 HVX = 1_000_000_000_000_000_000` base units. Timestamps are Unix seconds, and durations are seconds. Basis points express the initial unlock: `10000 = 100%`, `2500 = 25%`. The token generation event (TGE) is the configured schedule start.

## Deployed addresses

| Network | Token | Vault | Treasury Safe |
|---|---|---|---|
| BSC testnet (97) | `0x73d2230A6060180864E360c1e641767019cAB027` | `0xc0A0C9F25526554b0c777124ADAC00Cc5aE2022a` | `0xcA05ac7C594E2D7D2a16b8aebe56763500760779` |
| BSC mainnet (56) | No deployment recorded | | |

## Reading reverts

Both contracts use custom errors. When the RPC response includes revert data, ethers.js v6 can decode the error from a failed `staticCall` or transaction:

```ts
try {
  await vault.release.staticCall(1n);
} catch (e: any) {
  console.log(e.reason ?? vault.interface.parseError(e.data)?.name); // "NothingToRelease"
}
```
