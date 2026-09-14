# HiveX (HVX) — testnet trial guide

Everything below runs on BNB Smart Chain **Testnet**. Tokens have no value; this is a rehearsal of the real thing.

## What you need
- Chrome, Firefox or Brave with the [MetaMask](https://metamask.io) extension.
- The demo wallet seed phrase we sent you separately (12 words). It already holds test HVX and a little tBNB for gas.
- The demo page link.

## Steps
1. Open MetaMask → account menu → *Import wallet* / *Add account* → paste the 12 words.
2. Open the demo page. Click **Connect wallet**, approve the connection and the network switch to *BNB Smart Chain Testnet*.
3. Click **Add HVX to MetaMask**. Your HVX balance now shows inside MetaMask as well.
4. **Transfer**: enter any address and an amount, confirm in MetaMask. The balance updates on the page within a few seconds; click the address to see the transaction on BscScan.
5. **Burn**: enter an amount, confirm. *Total burned* goes up, *Current supply* goes down. This is exactly how the foundation's staged burns will look, just from the treasury multisig instead of your wallet.
6. **Vesting**: scroll to the schedule cards. The ones marked *(you)* belong to the demo wallet. When *Releasable now* is above zero, click **Release**. Tokens move from the vault into your wallet. Cards in *cliff* release nothing yet, no matter who clicks.
7. Everything on the page is read live from the blockchain. Open any address on BscScan to verify independently.

## What to look for
- Total supply is fixed. Nothing on the page, in the wallet or in the contract can create tokens.
- The foundation multisig needs 2 of 3 signers for anything. It cannot touch your balance.
- Locked amounts, unlock dates and released amounts are public and match what the contract enforces.

## If something does not work
- "Wrong network": click **Switch to BNB Testnet**.
- "Insufficient funds for gas": the wallet needs tBNB. Ask us or use https://www.bnbchain.org/en/testnet-faucet.
- Numbers look stale: wait 15 seconds, the page refreshes itself.
