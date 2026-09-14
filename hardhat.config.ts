import "dotenv/config";
import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          // OpenZeppelin 5.x needs Cancun (mcopy). BNB Smart Chain supports
          // Cancun since the 2024 Tycho hard fork.
          evmVersion: "cancun",
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
        },
      },
    },
  },
  test: {
    solidity: { fuzz: { runs: 1000 } },
  },
  networks: {
    hardhatMainnet: { type: "edr-simulated", chainType: "l1" },
    bscTestnet: {
      type: "http",
      chainType: "l1",
      chainId: 97,
      url: configVariable("BSC_TESTNET_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      chainId: 56,
      url: configVariable("BSC_RPC_URL"),
      accounts: [configVariable("DEPLOYER_PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      // Etherscan V2 API key works for BscScan (chainId 56 / 97).
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
