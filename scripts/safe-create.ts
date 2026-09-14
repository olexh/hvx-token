/**
 * Deploy a Gnosis Safe (rehearsal / testnet only). Owners come from .signers.<network>.json,
 * gas is paid by the configured deployer account.
 *
 *   THRESHOLD=2 npx hardhat run scripts/safe-create.ts --network bscTestnet
 */
import { readFileSync, writeFileSync } from "node:fs";
import { network } from "hardhat";
import Safe from "@safe-global/protocol-kit";

const { ethers, networkName, networkConfig } = await network.create();
const signers: { name: string; address: string; privateKey: string }[] = JSON.parse(
  readFileSync(`.signers.${networkName}.json`, "utf8"),
);
const threshold = Number(process.env.THRESHOLD ?? 2);
const rpcUrl = await (networkConfig as any).url.get();
const [deployer] = await ethers.getSigners();

const kit = await Safe.init({
  provider: rpcUrl,
  signer: process.env.DEPLOYER_PRIVATE_KEY!,
  predictedSafe: {
    safeAccountConfig: { owners: signers.map((s) => s.address), threshold },
    safeDeploymentConfig: { saltNonce: String(Date.now()) },
  },
});
const safeAddress = await kit.getAddress();
console.log(`predicted Safe: ${safeAddress} (${threshold} of ${signers.length})`);

const deployTx = await kit.createSafeDeploymentTransaction();
const tx = await deployer.sendTransaction({ to: deployTx.to, value: BigInt(deployTx.value), data: deployTx.data });
console.log(`tx=${tx.hash}`);
await tx.wait();

// Public BSC RPCs are load balanced; wait until every node sees the new code.
for (let i = 0; i < 10 && (await ethers.provider.getCode(safeAddress)).length <= 2; i++) {
  await new Promise((r) => setTimeout(r, 3000));
}
const deployed = await Safe.init({ provider: rpcUrl, safeAddress });
console.log(`deployed: ${await deployed.isSafeDeployed()} owners=${(await deployed.getOwners()).join(",")} threshold=${await deployed.getThreshold()}`);

const file = `deployments/${networkName}.safe.json`;
writeFileSync(file, JSON.stringify({ safeAddress, threshold, owners: signers.map((s) => s.address) }, null, 2) + "\n");
console.log(`saved ${file}`);
