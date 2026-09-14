/**
 * Sign and execute a Safe Transaction Builder batch JSON with local signer keys
 * (rehearsal / testnet only: on mainnet signers use the Safe web app).
 *
 *   BATCH=safe-batch.json npx hardhat run scripts/safe-exec.ts --network bscTestnet
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";
import Safe from "@safe-global/protocol-kit";

const { networkName, networkConfig } = await network.create();
const rpcUrl = await (networkConfig as any).url.get();
const signers: { name: string; address: string; privateKey: string }[] = JSON.parse(
  readFileSync(`.signers.${networkName}.json`, "utf8"),
);
const { safeAddress, threshold } = JSON.parse(readFileSync(`deployments/${networkName}.safe.json`, "utf8"));
const batch = JSON.parse(readFileSync(process.env.BATCH ?? "safe-batch.json", "utf8"));

const transactions = batch.transactions.map((t: any) => ({ to: t.to, value: t.value ?? "0", data: t.data }));
console.log(`Safe ${safeAddress}: ${transactions.length} calls, threshold ${threshold}`);

let kit = await Safe.init({ provider: rpcUrl, signer: signers[0].privateKey, safeAddress });
let safeTx = await kit.createTransaction({ transactions });

for (let i = 0; i < threshold; i++) {
  kit = await Safe.init({ provider: rpcUrl, signer: signers[i].privateKey, safeAddress });
  safeTx = await kit.signTransaction(safeTx);
  console.log(`  signed by ${signers[i].name} ${signers[i].address}`);
}

// Execute from the first signer (the one funded with gas); signatures are already attached.
kit = await Safe.init({ provider: rpcUrl, signer: signers[0].privateKey, safeAddress });
const result = await kit.executeTransaction(safeTx);
console.log(`executed tx=${result.hash}`);
