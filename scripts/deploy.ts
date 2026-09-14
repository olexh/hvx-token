/**
 * Deploys HVXToken (fixed supply minted to TREASURY) and HVXVestingVault (owned by TREASURY).
 *
 *   TREASURY=0xYourSafe npx hardhat run scripts/deploy.ts --network bscTestnet
 *
 * TREASURY must be the foundation multisig. The deployer key only pays gas and
 * holds no privileges afterwards.
 */
import { writeFileSync } from "node:fs";
import { network } from "hardhat";

const { ethers, networkName } = await network.create();

const treasury = process.env.TREASURY;
if (!treasury || !ethers.isAddress(treasury)) {
  throw new Error("Set TREASURY=<foundation multisig address> in the environment");
}

const [deployer] = await ethers.getSigners();
console.log(`network:  ${networkName}`);
console.log(`deployer: ${deployer.address}`);
console.log(`treasury: ${treasury}`);

const token = await ethers.deployContract("HVXToken", [treasury]);
await token.waitForDeployment();
const tokenAddress = await token.getAddress();
console.log(`HVXToken:        ${tokenAddress}`);

const vault = await ethers.deployContract("HVXVestingVault", [tokenAddress, treasury]);
await vault.waitForDeployment();
const vaultAddress = await vault.getAddress();
console.log(`HVXVestingVault: ${vaultAddress}`);

const out = {
  network: networkName,
  chainId: Number((await ethers.provider.getNetwork()).chainId),
  treasury,
  HVXToken: tokenAddress,
  HVXVestingVault: vaultAddress,
  deployedAt: new Date().toISOString(),
};
const file = `deployments/${networkName}.json`;
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.log(`\nSaved ${file}`);

console.log(`\nVerify on BscScan:`);
console.log(`  npx hardhat verify --network ${networkName} ${tokenAddress} ${treasury}`);
console.log(`  npx hardhat verify --network ${networkName} ${vaultAddress} ${tokenAddress} ${treasury}`);
