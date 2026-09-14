# HiveX (HVX) testnet guide

Use the demo on BNB Smart Chain Testnet to try transfers, burns and vesting releases. Test tokens have no monetary value.

## What you need

- Chrome, Firefox or Brave with the [MetaMask](https://metamask.io) extension.
- The demo wallet's 12-word seed phrase, supplied separately. The wallet is funded with test HVX and tBNB for gas.
- The demo page link.

## Steps

1. Import the supplied 12-word demo seed phrase into MetaMask.
2. Open the demo page. Click **Connect wallet**, approve the connection and the network switch to *BNB Smart Chain Testnet*.
3. Click **Add to MetaMask** to show your HVX balance in the wallet.
4. Click **Send**, enter a recipient address and amount, then click **Send HVX** and confirm in MetaMask. The page updates after confirmation. Open the transaction link under **Your activity** to view it on BscScan.
5. Click **Burn**, enter an amount, then click **Burn HVX** and confirm. **Burned** increases and **Total supply** decreases by that amount. The foundation uses the same function for staged burns from its Safe.
6. Under **Vesting schedules**, rows marked **yours** belong to the connected wallet. Click **Release** when a row has tokens available. Tokens go to that schedule's beneficiary, even if someone else triggers the release. During a cliff, only the initial unlock is claimable; if it is zero or already released, there is nothing to release.
7. Open any contract or wallet address on BscScan to check the balances and transactions shown on the page.

## What to look for

- The initial supply was minted at deployment. Burns reduce the current supply; no more tokens can be minted.
- The testnet foundation Safe requires 2 of 3 signers for its transactions. It can spend your tokens only if you grant it an allowance.
- Locked amounts, unlock dates and released amounts are public and match what the contract enforces.

## If something does not work

- Wrong network: click **Connect wallet** and approve the switch to BNB Smart Chain Testnet.
- Insufficient funds for gas: the wallet needs tBNB. Ask the demo contact or use the [BNB Chain testnet faucet](https://www.bnbchain.org/en/testnet-faucet).
- Stale balances: wait for the next refresh, which runs every 15 seconds.
