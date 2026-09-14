import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

const TOTAL_SUPPLY = ethers.parseUnits("100000000000", 18); // 100B * 1e18

describe("HVXToken", function () {
  async function deploy() {
    const [treasury, alice, bob] = await ethers.getSigners();
    const token = await ethers.deployContract("HVXToken", [treasury.address]);
    return { token, treasury, alice, bob };
  }

  it("has standard BEP-20 metadata and fixed supply minted to treasury", async function () {
    const { token, treasury } = await networkHelpers.loadFixture(deploy);
    expect(await token.name()).to.equal("HiveX");
    expect(await token.symbol()).to.equal("HVX");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY);
    expect(await token.TOTAL_SUPPLY()).to.equal(TOTAL_SUPPLY);
    expect(await token.balanceOf(treasury.address)).to.equal(TOTAL_SUPPLY);
  });

  it("rejects zero treasury", async function () {
    const factory = await ethers.getContractFactory("HVXToken");
    await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
  });

  it("exposes no mint / owner / pause / blacklist surface", async function () {
    const { token } = await networkHelpers.loadFixture(deploy);
    const fnNames = token.interface.fragments
      .filter((f) => f.type === "function")
      .map((f: any) => f.name as string);
    for (const forbidden of ["mint", "owner", "pause", "unpause", "blacklist", "freeze", "setFee", "transferOwnership"]) {
      expect(fnNames, `unexpected function ${forbidden}`).to.not.include(forbidden);
    }
  });

  it("supports transfer / approve / transferFrom", async function () {
    const { token, treasury, alice, bob } = await networkHelpers.loadFixture(deploy);
    const amt = ethers.parseEther("1000");

    await expect(token.connect(treasury).transfer(alice.address, amt)).to.changeTokenBalances(
      ethers,
      token,
      [treasury, alice],
      [-amt, amt],
    );

    await token.connect(alice).approve(bob.address, amt);
    expect(await token.allowance(alice.address, bob.address)).to.equal(amt);

    await expect(token.connect(bob).transferFrom(alice.address, bob.address, amt)).to.changeTokenBalances(
      ethers,
      token,
      [alice, bob],
      [-amt, amt],
    );
    expect(await token.allowance(alice.address, bob.address)).to.equal(0n);
  });

  it("rejects transfers over balance and to the zero address", async function () {
    const { token, treasury, alice } = await networkHelpers.loadFixture(deploy);
    await expect(token.connect(alice).transfer(treasury.address, 1n)).to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    await expect(token.connect(treasury).transfer(ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(token, "ERC20InvalidReceiver");
    await expect(token.connect(alice).transferFrom(treasury.address, alice.address, 1n)).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
  });

  it("burn reduces holder balance and total supply", async function () {
    const { token, treasury } = await networkHelpers.loadFixture(deploy);
    const amt = ethers.parseEther("5");
    await expect(token.connect(treasury).burn(amt)).to.changeTokenBalance(ethers, token, treasury, -amt);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY - amt);
    expect(await token.totalBurned()).to.equal(amt);
  });

  it("staged burns are verifiable: Transfer to zero address and totalBurned accumulate", async function () {
    const { token, treasury } = await networkHelpers.loadFixture(deploy);
    const stages = [ethers.parseEther("1000000"), ethers.parseEther("2500000"), ethers.parseEther("500000")];
    let burned = 0n;
    for (const amt of stages) {
      await expect(token.connect(treasury).burn(amt)).to.emit(token, "Transfer").withArgs(treasury.address, ethers.ZeroAddress, amt);
      burned += amt;
      expect(await token.totalBurned()).to.equal(burned);
      expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY - burned);
    }
  });

  it("burnFrom requires an explicit allowance (cannot burn arbitrary user balances)", async function () {
    const { token, treasury, alice } = await networkHelpers.loadFixture(deploy);
    const amt = ethers.parseEther("10");
    await token.connect(treasury).transfer(alice.address, amt);

    // Treasury (foundation) cannot burn Alice's tokens without her approval.
    await expect(token.connect(treasury).burnFrom(alice.address, amt)).to.be.revertedWithCustomError(
      token,
      "ERC20InsufficientAllowance",
    );

    // Alice designates tokens for burning by approving the foundation.
    await token.connect(alice).approve(treasury.address, amt);
    await expect(token.connect(treasury).burnFrom(alice.address, amt)).to.changeTokenBalance(ethers, token, alice, -amt);
    expect(await token.totalSupply()).to.equal(TOTAL_SUPPLY - amt);
  });

  it("supports EIP-2612 permit", async function () {
    const { token, treasury, alice, bob } = await networkHelpers.loadFixture(deploy);
    const value = ethers.parseEther("42");
    await token.connect(treasury).transfer(alice.address, value);

    const deadline = BigInt(await networkHelpers.time.latest()) + 3600n;
    const nonce = await token.nonces(alice.address);
    const { chainId } = await ethers.provider.getNetwork();

    const sig = await alice.signTypedData(
      { name: "HiveX", version: "1", chainId, verifyingContract: await token.getAddress() },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner: alice.address, spender: bob.address, value, nonce, deadline },
    );
    const { v, r, s } = ethers.Signature.from(sig);

    await token.connect(bob).permit(alice.address, bob.address, value, deadline, v, r, s);
    expect(await token.allowance(alice.address, bob.address)).to.equal(value);

    // replay is rejected (nonce consumed)
    await expect(token.connect(bob).permit(alice.address, bob.address, value, deadline, v, r, s)).to.be.revertedWithCustomError(token, "ERC2612InvalidSigner");
    await expect(token.connect(bob).transferFrom(alice.address, bob.address, value)).to.changeTokenBalances(
      ethers,
      token,
      [alice, bob],
      [-value, value],
    );
  });

  it("rejects expired permit", async function () {
    const { token, alice, bob } = await networkHelpers.loadFixture(deploy);
    const deadline = BigInt(await networkHelpers.time.latest()) - 1n;
    const { chainId } = await ethers.provider.getNetwork();
    const sig = await alice.signTypedData(
      { name: "HiveX", version: "1", chainId, verifyingContract: await token.getAddress() },
      { Permit: [
        { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" },
      ] },
      { owner: alice.address, spender: bob.address, value: 1n, nonce: 0n, deadline },
    );
    const { v, r, s } = ethers.Signature.from(sig);
    await expect(token.permit(alice.address, bob.address, 1n, deadline, v, r, s)).to.be.revertedWithCustomError(token, "ERC2612ExpiredSignature");
  });
});
