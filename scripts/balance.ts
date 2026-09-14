import { network } from "hardhat";
const { ethers, networkName } = await network.create();
const [deployer] = await ethers.getSigners();
const bal = await ethers.provider.getBalance(deployer.address);
console.log(`${networkName} chainId=${(await ethers.provider.getNetwork()).chainId} deployer=${deployer.address} balance=${ethers.formatEther(bal)} BNB`);
