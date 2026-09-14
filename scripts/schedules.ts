/**
 * Builds the vesting schedules described in a config file (see config/allocations.example.json).
 *
 * Two modes:
 *
 *  1. safe (default): prints a Safe Transaction Builder batch (JSON) containing
 *     `approve(vault, total)` + one `createSchedule(...)` per allocation. Upload it in
 *     the Gnosis Safe UI (Apps -> Transaction Builder -> import) and let the multisig sign.
 *
 *       CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bsc > safe-batch.json
 *
 *  2. send: signs and sends the transactions directly from the configured account.
 *     Only for testnets / dry runs where the deployer key IS the vault owner.
 *
 *       MODE=send CONFIG=config/allocations.json npx hardhat run scripts/schedules.ts --network bscTestnet
 */
import { readFileSync } from "node:fs";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();

const DAY = 24n * 60n * 60n;
const mode = process.env.MODE ?? "safe";
const configPath = process.env.CONFIG ?? "config/allocations.json";

type Allocation = {
  label: string;
  beneficiary: string;
  amount: string; // whole HVX
  initialUnlockBps: number;
  cliffDays: number;
  vestingDays: number;
  revocable: boolean;
};
type Config = { start: number; allocations: Allocation[] };

const cfg: Config = JSON.parse(readFileSync(configPath, "utf8"));
const deployment = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const vaultAddress: string = deployment.HVXVestingVault;
const tokenAddress: string = deployment.HVXToken;

const vaultIface = (await ethers.getContractFactory("HVXVestingVault")).interface;
const tokenIface = (await ethers.getContractFactory("HVXToken")).interface;

let total = 0n;
const calls: { to: string; data: string; description: string }[] = [];

for (const a of cfg.allocations) {
  if (!ethers.isAddress(a.beneficiary)) throw new Error(`${a.label}: bad beneficiary`);
  const amount = ethers.parseUnits(a.amount, 18);
  total += amount;
  const args = [
    a.beneficiary,
    a.label,
    amount,
    BigInt(cfg.start),
    BigInt(a.cliffDays) * DAY,
    BigInt(a.vestingDays) * DAY,
    a.initialUnlockBps,
    a.revocable,
  ] as const;
  calls.push({
    to: vaultAddress,
    data: vaultIface.encodeFunctionData("createSchedule", args),
    description: `createSchedule ${a.label}: ${a.amount} HVX -> ${a.beneficiary}`,
  });
}

const approve = {
  to: tokenAddress,
  data: tokenIface.encodeFunctionData("approve", [vaultAddress, total]),
  description: `approve vault for ${ethers.formatUnits(total, 18)} HVX`,
};

if (mode === "send") {
  const [signer] = await ethers.getSigners();
  console.log(`Sending ${calls.length + 1} txs from ${signer.address} on ${networkName}`);
  for (const c of [approve, ...calls]) {
    const tx = await signer.sendTransaction({ to: c.to, data: c.data });
    console.log(`  ${c.description}  tx=${tx.hash}`);
    await tx.wait();
  }
  console.log("done");
} else {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const batch = {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: {
      name: "HVX vesting schedules",
      description: `approve + ${calls.length} createSchedule calls (total ${ethers.formatUnits(total, 18)} HVX)`,
    },
    transactions: [approve, ...calls].map((c) => ({
      to: c.to,
      value: "0",
      data: c.data,
      contractMethod: null,
      contractInputsValues: null,
    })),
  };
  console.log(JSON.stringify(batch, null, 2));
}
