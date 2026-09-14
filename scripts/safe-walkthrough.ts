/**
 * Shows how the Safe multisig works, step by step (testnet only).
 * Proposes a harmless call (token.approve(vault, 1)), tries to execute with one
 * signature (rejected), adds the second, executes, and prints the on-chain proof.
 *
 *   npx hardhat run scripts/safe-walkthrough.ts --network bscTestnet
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";
import Safe from "@safe-global/protocol-kit";

const { ethers, networkName, networkConfig } = await network.create();
const rpcUrl = await (networkConfig as any).url.get();
const d = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const { safeAddress } = JSON.parse(readFileSync(`deployments/${networkName}.safe.json`, "utf8"));
const signers: { name: string; address: string; privateKey: string }[] = JSON.parse(readFileSync(`.signers.${networkName}.json`, "utf8"));
const token = await ethers.getContractAt("HVXToken", d.HVXToken);
const safeC = new ethers.Contract(safeAddress, ["function nonce() view returns (uint256)", "function getThreshold() view returns (uint256)", "function getOwners() view returns (address[])"], ethers.provider);

const log = (s: string) => console.log(s);
log(`Safe ${safeAddress}`);
log(`  owners    ${(await safeC.getOwners()).map((o: string) => o.slice(0, 8)).join(", ")}`);
log(`  threshold ${await safeC.getThreshold()}   nonce ${await safeC.nonce()}\n`);

// 1. propose
const call = { to: d.HVXToken, value: "0", data: token.interface.encodeFunctionData("approve", [d.HVXVestingVault, 1n]) };
let kit = await Safe.init({ provider: rpcUrl, signer: signers[0].privateKey, safeAddress });
let tx = await kit.createTransaction({ transactions: [call] });
const hash = await kit.getTransactionHash(tx);
log(`1. ${signers[0].name} proposes: token.approve(vault, 1)`);
log(`   safeTxHash ${hash}   (what every signer signs; includes nonce ${tx.data.nonce})\n`);

// 2. first signature
tx = await kit.signTransaction(tx);
log(`2. ${signers[0].name} signs  -> ${tx.signatures.size} signature(s) collected\n`);

// 3. try to execute with one signature
log(`3. try to execute with 1 of 2 signatures ...`);
try {
  await kit.executeTransaction(tx);
  log(`   executed?! (should not happen)`);
} catch (e: any) {
  const m = String(e?.message ?? e);
  log(`   REJECTED by the Safe contract: ${m.includes("GS020") ? "GS020 = signatures below threshold" : m.slice(0, 120)}\n`);
}

// 4. second signature
kit = await Safe.init({ provider: rpcUrl, signer: signers[1].privateKey, safeAddress });
tx = await kit.signTransaction(tx);
log(`4. ${signers[1].name} signs  -> ${tx.signatures.size} signature(s) collected`);
for (const [addr] of tx.signatures) log(`   signature from ${addr.slice(0, 8)}`);
log(`   ${signers[2].name} did not sign and is not needed\n`);

// 5. execute
kit = await Safe.init({ provider: rpcUrl, signer: signers[0].privateKey, safeAddress });
const res = await kit.executeTransaction(tx);
const rc = await ethers.provider.waitForTransaction(res.hash!);
log(`5. ${signers[0].name} executes  tx ${res.hash}`);
log(`   gas paid by ${signers[0].name}; the token saw the call coming from the Safe`);
log(`   allowance(safe -> vault) now ${await token.allowance(safeAddress, d.HVXVestingVault)}`);
log(`   Safe nonce now ${await safeC.nonce()}  (same hash can never be replayed)`);
const ev = rc!.logs.find((l) => l.address.toLowerCase() === safeAddress.toLowerCase());
log(`   Safe emitted ${ev ? "ExecutionSuccess" : "(no event found)"}`);
log(`\nhttps://testnet.bscscan.com/tx/${res.hash}`);
