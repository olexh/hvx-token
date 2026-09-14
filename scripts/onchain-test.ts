/**
 * Full on-chain feature test against a live testnet deployment (testnet only).
 * Exercises every public function of HVXToken and HVXVestingVault, including the
 * Safe-owner paths (signed by local signer keys) and expected reverts.
 *
 * Needs: deployments/<net>.json, deployments/<net>.safe.json, .signers.<net>.json,
 *        .demo-wallet.<net>.json (demo wallet holding HVX + gas), deployer with gas.
 *
 *   npx hardhat run scripts/onchain-test.ts --network bscTestnet
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";
import Safe from "@safe-global/protocol-kit";

const { ethers, networkName, networkConfig } = await network.create();
const rpcUrl = await (networkConfig as any).url.get();
const d = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const { safeAddress, threshold } = JSON.parse(readFileSync(`deployments/${networkName}.safe.json`, "utf8"));
const signers: { privateKey: string }[] = JSON.parse(readFileSync(`.signers.${networkName}.json`, "utf8"));
const demoCfg = JSON.parse(readFileSync(`.demo-wallet.${networkName}.json`, "utf8"));

const [deployer] = await ethers.getSigners();
const demo = new ethers.Wallet(demoCfg.privateKey, ethers.provider);
const token = await ethers.getContractAt("HVXToken", d.HVXToken, demo);
const vault = await ethers.getContractAt("HVXVestingVault", d.HVXVestingVault, demo);
const tokenIface = token.interface;
const vaultIface = vault.interface;
const fmt = (x: bigint) => ethers.formatUnits(x, 18);
const E = ethers.parseEther;

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}`); };

/** Retry a read until it matches (public RPCs can lag a block). */
async function eventually<T>(fn: () => Promise<T>, expect: (v: T) => boolean, tries = 10): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !expect(v); i++) { await new Promise((r) => setTimeout(r, 2000)); v = await fn(); }
  return v;
}
/** Expect a call to revert with the given custom error name. */
async function reverts(label: string, p: Promise<unknown>, errName: string) {
  try { await p; ok(`${label} reverts ${errName}`, false); }
  catch (e: any) { const msg = String(e?.message ?? e) + JSON.stringify(e?.data ?? ""); ok(`${label} reverts ${errName}`, msg.includes(errName) || decodeErr(e) === errName); }
}
function decodeErr(e: any): string {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data !== "string") return "";
  for (const iface of [tokenIface, vaultIface]) { try { const p = iface.parseError(data); if (p) return p.name; } catch {} }
  return "";
}
/** Sign with `threshold` local signers and execute a batch from the Safe. */
async function safeExec(label: string, calls: { to: string; data: string }[]) {
  let kit = await Safe.init({ provider: rpcUrl, signer: signers[0].privateKey, safeAddress });
  let tx = await kit.createTransaction({ transactions: calls.map((c) => ({ ...c, value: "0" })) });
  for (let i = 0; i < threshold; i++) {
    kit = await Safe.init({ provider: rpcUrl, signer: signers[i].privateKey, safeAddress });
    tx = await kit.signTransaction(tx);
  }
  kit = await Safe.init({ provider: rpcUrl, signer: signers[0].privateKey, safeAddress });
  const res = await kit.executeTransaction(tx);
  await ethers.provider.waitForTransaction(res.hash!);
  console.log(`      safe: ${label} tx=${res.hash}`);
}
/** eth_call as if sent from the Safe (no signatures needed to observe reverts). */
async function asSafe(c: any, fn: string, args: unknown[]) {
  try {
    return await ethers.provider.call({ to: await c.getAddress(), from: safeAddress, data: c.interface.encodeFunctionData(fn, args) });
  } catch (e: any) {
    const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    const name = decodeErr({ data });
    throw new Error(name ? `reverted: ${name}` : String(e?.message ?? e));
  }
}

console.log(`token ${d.HVXToken}\nvault ${d.HVXVestingVault}\nsafe  ${safeAddress}\n`);

// ---- token: metadata
console.log("── HVXToken");
ok("name = HiveX", (await token.name()) === "HiveX");
ok("symbol = HVX", (await token.symbol()) === "HVX");
ok("decimals = 18", (await token.decimals()) === 18n);
ok("TOTAL_SUPPLY = 100B", (await token.TOTAL_SUPPLY()) === E("100000000000"));
ok("totalSupply + totalBurned = TOTAL_SUPPLY", (await token.totalSupply()) + (await token.totalBurned()) === E("100000000000"));
ok("DOMAIN_SEPARATOR present", ((await token.DOMAIN_SEPARATOR()) as string).length === 66);

// transfer / approve / transferFrom
const alice = ethers.Wallet.createRandom().connect(ethers.provider);
await (await token.transfer(alice.address, E("100"))).wait();
ok("transfer 100 -> alice", (await eventually(() => token.balanceOf(alice.address), (v) => v === E("100"))) === E("100"));
await (await token.approve(deployer.address, E("40"))).wait();
ok("approve deployer 40", (await eventually(() => token.allowance(demo.address, deployer.address), (v) => v === E("40"))) === E("40"));
await (await token.connect(deployer).transferFrom(demo.address, alice.address, E("30"))).wait();
ok("transferFrom 30 by deployer", (await eventually(() => token.balanceOf(alice.address), (v) => v === E("130"))) === E("130"));
ok("allowance reduced to 10", (await eventually(() => token.allowance(demo.address, deployer.address), (v) => v === E("10"))) === E("10"));
await reverts("transferFrom over allowance", token.connect(deployer).transferFrom.staticCall(demo.address, alice.address, E("11")), "ERC20InsufficientAllowance");
await reverts("transfer over balance", token.connect(deployer).transfer.staticCall(alice.address, E("1")), "ERC20InsufficientBalance");
await reverts("transfer to zero address", token.transfer.staticCall(ethers.ZeroAddress, 1n), "ERC20InvalidReceiver");

// burn / burnFrom / totalBurned
const burnedBefore = await token.totalBurned();
const supplyBefore = await token.totalSupply();
const rc = await (await token.burn(E("1000000"))).wait();
const log = rc!.logs.find((l) => l.address === d.HVXToken && l.topics[0] === ethers.id("Transfer(address,address,uint256)"));
ok("burn emits Transfer(demo, 0x0, 1M)", !!log && log.topics[2] === ethers.zeroPadValue(ethers.ZeroAddress, 32));
ok("totalBurned += 1M", (await eventually(() => token.totalBurned(), (v) => v === burnedBefore + E("1000000"))) === burnedBefore + E("1000000"));
ok("totalSupply -= 1M", (await token.totalSupply()) === supplyBefore - E("1000000"));
await reverts("burnFrom without allowance", token.connect(deployer).burnFrom.staticCall(alice.address, 1n), "ERC20InsufficientAllowance");
await (await token.connect(deployer).burnFrom(demo.address, E("10"))).wait(); // uses remaining 10 allowance
ok("burnFrom with allowance burns 10", (await eventually(() => token.totalBurned(), (v) => v === burnedBefore + E("1000010"))) === burnedBefore + E("1000010"));
await reverts("burn over balance", token.connect(deployer).burn.staticCall(1n), "ERC20InsufficientBalance");

// permit
const spender = ethers.Wallet.createRandom().address;
const { chainId } = await ethers.provider.getNetwork();
const domain = { name: "HiveX", version: "1", chainId, verifyingContract: d.HVXToken };
const types = { Permit: [
  { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
  { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] };
const nonce = await token.nonces(demo.address);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
const sig = ethers.Signature.from(await demo.signTypedData(domain, types, { owner: demo.address, spender, value: 777n, nonce, deadline }));
await (await token.connect(deployer).permit(demo.address, spender, 777n, deadline, sig.v, sig.r, sig.s)).wait();
ok("permit sets allowance 777 (submitted by third party)", (await eventually(() => token.allowance(demo.address, spender), (v) => v === 777n)) === 777n);
ok("nonce incremented", (await token.nonces(demo.address)) === nonce + 1n);
await reverts("permit replay", token.permit.staticCall(demo.address, spender, 777n, deadline, sig.v, sig.r, sig.s), "ERC2612InvalidSigner");
const expired = ethers.Signature.from(await demo.signTypedData(domain, types, { owner: demo.address, spender, value: 1n, nonce: nonce + 1n, deadline: 1n }));
await reverts("permit expired", token.permit.staticCall(demo.address, spender, 1n, 1n, expired.v, expired.r, expired.s), "ERC2612ExpiredSignature");

// no admin surface
const fns = token.interface.fragments.filter((f) => f.type === "function").map((f: any) => f.name);
ok("no mint/owner/pause/blacklist functions", !["mint", "owner", "pause", "blacklist", "setFee"].some((n) => fns.includes(n)));

// ---- vault: views
console.log("── HVXVestingVault views");
ok("token()", (await vault.token()) === d.HVXToken);
ok("owner() = Safe", (await vault.owner()) === safeAddress);
ok("BPS_DENOMINATOR = 10000", (await vault.BPS_DENOMINATOR()) === 10000n);
const n = await vault.scheduleCount();
ok(`scheduleCount = ${n}`, n >= 7n);
const s0 = await vault.getSchedule(0n);
ok(`getSchedule(0) label=${s0.label} total=${fmt(s0.total)}`, s0.label === "Sales" && s0.total === E("10000000000"));
ok("vestedAmountAt(0, start-1) = 0", (await vault.vestedAmountAt(0n, s0.start - 1n)) === 0n);
ok("vestedAmountAt(0, start) = 20% TGE", (await vault.vestedAmountAt(0n, s0.start)) === (s0.total * 2000n) / 10000n);
const end0 = await vault.vestingEnd(0n);
ok("vestingEnd(0) = start+cliff+vesting", end0 === s0.start + s0.cliffDuration + s0.vestingDuration);
ok("vestedAmountAt(0, end) = total", (await vault.vestedAmountAt(0n, end0)) === s0.total);
ok("vested + locked = total", (await vault.vestedAmount(0n)) + (await vault.lockedAmount(0n)) === s0.total);
ok("releasable = vested - released", (await vault.releasableAmount(0n)) === (await vault.vestedAmount(0n)) - (await vault.releasedAmount(0n)));
ok("schedulesOf(demo) contains 0", (await vault.schedulesOf(demo.address)).includes(0n));
let sumOutstanding = 0n;
for (let i = 0n; i < n; i++) sumOutstanding += await vault.outstandingAmount(i);
ok("totalCommitted = Σ outstandingAmount", (await vault.totalCommitted()) === sumOutstanding);
ok("balance >= totalCommitted", (await token.balanceOf(d.HVXVestingVault)) >= (await vault.totalCommitted()));
await reverts("getSchedule(999)", vault.getSchedule(999n), "UnknownSchedule");

// ---- vault: permissionless
console.log("── HVXVestingVault permissionless");
const relBefore = await vault.releasedAmount(0n);
const demoBefore = await token.balanceOf(demo.address);
await (await vault.connect(deployer).release(0n)).wait(); // third party triggers, demo receives
ok("release(0) by third party pays beneficiary", (await eventually(() => token.balanceOf(demo.address), (v) => v > demoBefore)) > demoBefore);
ok("releasedAmount(0) increased", (await vault.releasedAmount(0n)) > relBefore);
await reverts("release(1) Foundation inside cliff", vault.release.staticCall(1n), "NothingToRelease");
await reverts("release(999)", vault.release.staticCall(999n), "UnknownSchedule");

await reverts("changeBeneficiary by non-beneficiary", vault.connect(deployer).changeBeneficiary.staticCall(0n, deployer.address), "NotBeneficiary");
await reverts("changeBeneficiary to zero", vault.changeBeneficiary.staticCall(0n, ethers.ZeroAddress), "ZeroAddress");
await reverts("changeBeneficiary to vault", vault.changeBeneficiary.staticCall(0n, d.HVXVestingVault), "InvalidBeneficiary");
await reverts("changeBeneficiary to same", vault.changeBeneficiary.staticCall(0n, demo.address), "InvalidBeneficiary");
const s5 = await vault.getSchedule(5n);
const s5Owner = s5.beneficiary === demo.address ? demo : null;
if (s5Owner) {
  await (await vault.changeBeneficiary(5n, alice.address)).wait();
  ok("changeBeneficiary(5, alice)", (await eventually(() => vault.getSchedule(5n), (s) => s.beneficiary === alice.address)).beneficiary === alice.address);
  ok("schedulesOf(alice) has 5, demo not", (await vault.schedulesOf(alice.address)).includes(5n) && !(await vault.schedulesOf(demo.address)).includes(5n));
} else ok("changeBeneficiary(5) skipped: already moved in a previous run", true);

// ---- vault: non-owner rejections
console.log("── HVXVestingVault access control");
await reverts("createSchedule by non-owner", vault.createSchedule.staticCall(demo.address, "x", 1n, 0n, 0n, 0n, 0n, false), "OwnableUnauthorizedAccount");
await reverts("revoke by non-owner", vault.revoke.staticCall(3n), "OwnableUnauthorizedAccount");
await reverts("withdrawUnallocated by non-owner", vault.withdrawUnallocated.staticCall(demo.address), "OwnableUnauthorizedAccount");
await reverts("recoverERC20 by non-owner", vault.recoverERC20.staticCall(d.HVXToken, demo.address, 1n), "OwnableUnauthorizedAccount");
await reverts("acceptOwnership by non-pending", vault.acceptOwnership.staticCall(), "OwnableUnauthorizedAccount");

// owner-only reverts, evaluated as the Safe via eth_call
await reverts("revoke(6) non-revocable (as Safe)", asSafe(vault, "revoke", [6n]), "NotRevocable");
await reverts("recoverERC20(HVX) (as Safe)", asSafe(vault, "recoverERC20", [d.HVXToken, demo.address, 1n]), "CannotRecoverVaultToken");
await reverts("createSchedule bps>10000 (as Safe)", asSafe(vault, "createSchedule", [demo.address, "x", 1n, 0n, 0n, 0n, 10001n, false]), "InvalidSchedule");
await reverts("createSchedule total=0 (as Safe)", asSafe(vault, "createSchedule", [demo.address, "x", 0n, 0n, 0n, 0n, 0n, false]), "ZeroAmount");
await reverts("createSchedule beneficiary=vault (as Safe)", asSafe(vault, "createSchedule", [d.HVXVestingVault, "x", 1n, 0n, 0n, 0n, 0n, false]), "InvalidBeneficiary");

// ---- vault: owner actions through the Safe
console.log("── HVXVestingVault owner actions via Safe");
const s3 = await vault.getSchedule(3n);
if (s3.revocable && !s3.revoked) {
  const safeBefore = await token.balanceOf(safeAddress);
  const vested3 = await vault.vestedAmount(3n);
  await safeExec("revoke(3) Team", [{ to: d.HVXVestingVault, data: vaultIface.encodeFunctionData("revoke", [3n]) }]);
  const s3after = await eventually(() => vault.getSchedule(3n), (s) => s.revoked);
  ok("revoke(3): revoked flag + revokedAt set, original total kept", s3after.revoked && s3after.revokedAt > 0n && s3after.total === s3.total);
  ok("revoke(3): vestedAmount frozen, history before revoke unchanged", (await vault.vestedAmount(3n)) === vested3 && (await vault.vestedAmountAt(3n, s3.start - 1n)) === 0n);
  ok("revoke(3): outstanding = vested - released", (await vault.outstandingAmount(3n)) === vested3 - s3after.released);
  ok(`revoke(3): Safe refunded ${fmt(s3.total - vested3)}`, (await token.balanceOf(safeAddress)) === safeBefore + (s3.total - vested3));
  ok("revoke(3): lockedAmount = 0", (await vault.lockedAmount(3n)) === 0n);
  await reverts("revoke(3) again (as Safe)", asSafe(vault, "revoke", [3n]), "AlreadyRevoked");
} else ok("revoke(3) skipped: already revoked in a previous run", true);

// stray HVX -> withdrawUnallocated
await (await token.transfer(d.HVXVestingVault, E("5"))).wait();
const unalloc = await eventually(() => vault.unallocated(), (v) => v >= E("5"));
ok(`unallocated = ${fmt(unalloc)} after stray transfer`, unalloc >= E("5"));
await reverts("withdrawUnallocated to zero (as Safe)", asSafe(vault, "withdrawUnallocated", [ethers.ZeroAddress]), "ZeroAddress");
const aliceBefore = await token.balanceOf(alice.address);
await safeExec("withdrawUnallocated(alice)", [{ to: d.HVXVestingVault, data: vaultIface.encodeFunctionData("withdrawUnallocated", [alice.address]) }]);
ok("withdrawUnallocated moved stray to alice", (await eventually(() => token.balanceOf(alice.address), (v) => v === aliceBefore + unalloc)) === aliceBefore + unalloc);
ok("unallocated = 0", (await vault.unallocated()) === 0n);
await reverts("withdrawUnallocated when nothing (as Safe)", asSafe(vault, "withdrawUnallocated", [alice.address]), "ZeroAmount");

// recoverERC20 with a foreign token
const foreign = await (await ethers.getContractFactory("HVXToken", deployer)).deploy(demo.address);
await foreign.waitForDeployment();
const foreignAddr = await foreign.getAddress();
await (await foreign.connect(demo).transfer(d.HVXVestingVault, E("7"))).wait();
await safeExec("recoverERC20(foreign, alice, 7)", [{ to: d.HVXVestingVault, data: vaultIface.encodeFunctionData("recoverERC20", [foreignAddr, alice.address, E("7")]) }]);
ok("recoverERC20 returned foreign token", (await eventually(() => foreign.balanceOf(alice.address), (v) => v === E("7"))) === E("7"));

// re-use refunded tokens: Safe creates a new schedule, fully unlocked, to demo; demo releases
const safeBal = await token.balanceOf(safeAddress);
if (safeBal > 0n) {
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  const newId = await vault.scheduleCount();
  await safeExec("approve + createSchedule(Team-2, 100% TGE)", [
    { to: d.HVXToken, data: tokenIface.encodeFunctionData("approve", [d.HVXVestingVault, safeBal]) },
    { to: d.HVXVestingVault, data: vaultIface.encodeFunctionData("createSchedule", [demo.address, "Team-2", safeBal, now - 1n, 0n, 0n, 10000n, false]) },
  ]);
  const sn = await eventually(() => vault.getSchedule(newId), (s) => s.total === safeBal);
  ok(`createSchedule via Safe: #${newId} ${sn.label} ${fmt(sn.total)}`, sn.beneficiary === demo.address && sn.total === safeBal);
  ok("Safe balance now 0", (await token.balanceOf(safeAddress)) === 0n);
  const b = await token.balanceOf(demo.address);
  await (await vault.release(newId)).wait();
  ok("release(new) pays full amount immediately", (await eventually(() => token.balanceOf(demo.address), (v) => v === b + safeBal)) === b + safeBal);
} else ok("createSchedule via Safe skipped: Safe holds no HVX", true);

// ---- ownership two-step round trip
console.log("── Ownable2Step");
await safeExec("transferOwnership(deployer)", [{ to: d.HVXVestingVault, data: vaultIface.encodeFunctionData("transferOwnership", [deployer.address]) }]);
ok("pendingOwner = deployer, owner still Safe", (await eventually(() => vault.pendingOwner(), (v) => v === deployer.address)) === deployer.address && (await vault.owner()) === safeAddress);
await reverts("acceptOwnership by demo", vault.acceptOwnership.staticCall(), "OwnableUnauthorizedAccount");
await (await vault.connect(deployer).acceptOwnership()).wait();
ok("owner = deployer after accept", (await eventually(() => vault.owner(), (v) => v === deployer.address)) === deployer.address);
await (await vault.connect(deployer).transferOwnership(safeAddress)).wait();
await safeExec("acceptOwnership (Safe)", [{ to: d.HVXVestingVault, data: vaultIface.encodeFunctionData("acceptOwnership", []) }]);
ok("owner back to Safe", (await eventually(() => vault.owner(), (v) => v === safeAddress)) === safeAddress);

// final invariant
sumOutstanding = 0n;
const n2 = await vault.scheduleCount();
for (let i = 0n; i < n2; i++) sumOutstanding += await vault.outstandingAmount(i);
ok("final: totalCommitted = Σ outstandingAmount", (await vault.totalCommitted()) === sumOutstanding);
ok("final: vault balance = totalCommitted (no stray)", (await token.balanceOf(d.HVXVestingVault)) === (await vault.totalCommitted()));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
