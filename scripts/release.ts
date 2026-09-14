/**
 * Release vested tokens of one schedule to its beneficiary (anyone may call).
 *
 *   ID=2 npx hardhat run scripts/release.ts --network bsc
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();
const deployment = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const vault = await ethers.getContractAt("HVXVestingVault", deployment.HVXVestingVault);
const id = BigInt(process.env.ID ?? "0");

const s = await vault.getSchedule(id);
const releasable = await vault.releasableAmount(id);
console.log(`#${id} ${s.label}: releasable ${ethers.formatUnits(releasable, 18)} HVX -> ${s.beneficiary}`);
const tx = await vault.release(id);
console.log(`tx=${tx.hash}`);
await tx.wait();
console.log(`released total: ${ethers.formatUnits(await vault.releasedAmount(id), 18)} HVX`);
