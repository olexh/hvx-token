/**
 * Prints every vesting schedule with locked / vested / released / releasable balances.
 *
 *   npx hardhat run scripts/status.ts --network bsc
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();
const deployment = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));

const token = await ethers.getContractAt("HVXToken", deployment.HVXToken);
const vault = await ethers.getContractAt("HVXVestingVault", deployment.HVXVestingVault);
const fmt = (x: bigint) => ethers.formatUnits(x, 18);
const ts = (x: bigint) => new Date(Number(x) * 1000).toISOString();

console.log(`HVXToken        ${deployment.HVXToken}`);
console.log(`  totalSupply   ${fmt(await token.totalSupply())} HVX`);
console.log(`HVXVestingVault ${deployment.HVXVestingVault}`);
console.log(`  owner         ${await vault.owner()}`);
console.log(`  balance       ${fmt(await token.balanceOf(deployment.HVXVestingVault))} HVX`);
console.log(`  committed     ${fmt(await vault.totalCommitted())} HVX`);
console.log(`  unallocated   ${fmt(await vault.unallocated())} HVX`);

const n = await vault.scheduleCount();
for (let i = 0n; i < n; i++) {
  const s = await vault.getSchedule(i);
  const [vested, releasable, locked, end] = await Promise.all([
    vault.vestedAmount(i),
    vault.releasableAmount(i),
    vault.lockedAmount(i),
    vault.vestingEnd(i),
  ]);
  console.log(`\n#${i} ${s.label}${s.revoked ? " (REVOKED)" : ""}${s.revocable ? " [revocable]" : ""}`);
  console.log(`  beneficiary ${s.beneficiary}`);
  console.log(`  total       ${fmt(s.total)}`);
  console.log(`  released    ${fmt(s.released)}`);
  console.log(`  vested      ${fmt(vested)}`);
  console.log(`  releasable  ${fmt(releasable)}`);
  console.log(`  locked      ${fmt(locked)}`);
  console.log(`  start       ${ts(s.start)}  cliff ${Number(s.cliffDuration) / 86400}d  linear ${Number(s.vestingDuration) / 86400}d  TGE ${Number(s.initialUnlockBps) / 100}%`);
  console.log(`  fully vested ${ts(end)}`);
}
