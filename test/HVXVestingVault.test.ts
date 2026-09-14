import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { time } = networkHelpers;

const DAY = 24n * 60n * 60n;
const MONTH = 30n * DAY;
const BPS = 10_000n;

describe("HVXVestingVault", function () {
  async function deploy() {
    const [foundation, team, marketing, other, stranger] = await ethers.getSigners();
    const token = await ethers.deployContract("HVXToken", [foundation.address]);
    const vault = await ethers.deployContract("HVXVestingVault", [await token.getAddress(), foundation.address]);
    await token.connect(foundation).approve(await vault.getAddress(), ethers.MaxUint256);
    const start = BigInt(await time.latest()) + 7n * DAY; // TGE in one week
    return { token, vault, foundation, team, marketing, other, stranger, start };
  }

  // Helper: create a schedule and return its id.
  async function create(
    ctx: Awaited<ReturnType<typeof deploy>>,
    opts: {
      beneficiary?: string;
      label?: string;
      total?: bigint;
      start?: bigint;
      cliff?: bigint;
      duration?: bigint;
      initialBps?: bigint;
      revocable?: boolean;
    } = {},
  ) {
    const args = [
      opts.beneficiary ?? ctx.team.address,
      opts.label ?? "Team",
      opts.total ?? ethers.parseEther("1000000"),
      opts.start ?? ctx.start,
      opts.cliff ?? 6n * MONTH,
      opts.duration ?? 24n * MONTH,
      opts.initialBps ?? 0n,
      opts.revocable ?? false,
    ] as const;
    const id = await ctx.vault.connect(ctx.foundation).createSchedule.staticCall(...args);
    await ctx.vault.connect(ctx.foundation).createSchedule(...args);
    return { id, args };
  }

  describe("deployment", function () {
    it("stores token and owner", async function () {
      const { token, vault, foundation } = await networkHelpers.loadFixture(deploy);
      expect(await vault.token()).to.equal(await token.getAddress());
      expect(await vault.owner()).to.equal(foundation.address);
      expect(await vault.scheduleCount()).to.equal(0n);
    });

    it("rejects zero token", async function () {
      const [foundation] = await ethers.getSigners();
      const f = await ethers.getContractFactory("HVXVestingVault");
      await expect(f.deploy(ethers.ZeroAddress, foundation.address)).to.be.revertedWithCustomError(f, "ZeroAddress");
    });
  });

  describe("createSchedule", function () {
    it("pulls tokens from owner, records schedule and emits event", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1000000");
      const vaultAddr = await ctx.vault.getAddress();

      await expect(
        ctx.vault.connect(ctx.foundation).createSchedule(ctx.team.address, "Team", total, ctx.start, 6n * MONTH, 24n * MONTH, 500n, true),
      )
        .to.emit(ctx.vault, "ScheduleCreated")
        .withArgs(0n, ctx.team.address, "Team", total, ctx.start, 6n * MONTH, 24n * MONTH, 500n, true);

      expect(await ctx.token.balanceOf(vaultAddr)).to.equal(total);
      expect(await ctx.vault.totalCommitted()).to.equal(total);
      expect(await ctx.vault.scheduleCount()).to.equal(1n);
      expect(await ctx.vault.schedulesOf(ctx.team.address)).to.deep.equal([0n]);

      const s = await ctx.vault.getSchedule(0n);
      expect(s.beneficiary).to.equal(ctx.team.address);
      expect(s.label).to.equal("Team");
      expect(s.total).to.equal(total);
      expect(s.released).to.equal(0n);
      expect(s.start).to.equal(ctx.start);
      expect(s.cliffDuration).to.equal(6n * MONTH);
      expect(s.vestingDuration).to.equal(24n * MONTH);
      expect(s.initialUnlockBps).to.equal(500n);
      expect(s.revocable).to.equal(true);
      expect(s.revoked).to.equal(false);
      expect(await ctx.vault.vestingEnd(0n)).to.equal(ctx.start + 30n * MONTH);
    });

    it("only owner can create", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      await expect(
        ctx.vault.connect(ctx.stranger).createSchedule(ctx.team.address, "x", 1n, ctx.start, 0n, 0n, 0n, false),
      ).to.be.revertedWithCustomError(ctx.vault, "OwnableUnauthorizedAccount");
    });

    it("validates inputs", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const v = ctx.vault.connect(ctx.foundation);
      await expect(v.createSchedule(ethers.ZeroAddress, "x", 1n, ctx.start, 0n, 0n, 0n, false)).to.be.revertedWithCustomError(v, "ZeroAddress");
      await expect(v.createSchedule(await ctx.vault.getAddress(), "x", 1n, ctx.start, 0n, 0n, 0n, false)).to.be.revertedWithCustomError(v, "InvalidBeneficiary");
      await expect(v.createSchedule(await ctx.token.getAddress(), "x", 1n, ctx.start, 0n, 0n, 0n, false)).to.be.revertedWithCustomError(v, "InvalidBeneficiary");
      await expect(v.createSchedule(ctx.team.address, "x", 0n, ctx.start, 0n, 0n, 0n, false)).to.be.revertedWithCustomError(v, "ZeroAmount");
      await expect(v.createSchedule(ctx.team.address, "x", 1n, ctx.start, 0n, 0n, 10_001n, false)).to.be.revertedWithCustomError(v, "InvalidSchedule");
      const max = 2n ** 64n - 1n;
      await expect(v.createSchedule(ctx.team.address, "x", 1n, max, 1n, 0n, 0n, false)).to.be.revertedWithCustomError(v, "InvalidSchedule");
    });

    it("fails without allowance / balance", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      await ctx.token.connect(ctx.foundation).approve(await ctx.vault.getAddress(), 0n);
      await expect(
        ctx.vault.connect(ctx.foundation).createSchedule(ctx.team.address, "x", 1n, ctx.start, 0n, 0n, 0n, false),
      ).to.be.revertedWithCustomError(ctx.token, "ERC20InsufficientAllowance");
    });
  });

  describe("vesting math", function () {
    it("cliff + linear: 0 before start, 0 during cliff, linear after, full at end", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("2400");
      const { id } = await create(ctx, { total, cliff: 6n * MONTH, duration: 24n * MONTH });

      expect(await ctx.vault.vestedAmount(id)).to.equal(0n);
      expect(await ctx.vault.lockedAmount(id)).to.equal(total);

      await time.increaseTo(ctx.start);
      expect(await ctx.vault.vestedAmount(id)).to.equal(0n);

      await time.increaseTo(ctx.start + 6n * MONTH - 1n);
      expect(await ctx.vault.vestedAmount(id)).to.equal(0n);

      await time.increaseTo(ctx.start + 6n * MONTH); // cliff end, linear begins
      expect(await ctx.vault.vestedAmount(id)).to.equal(0n);

      await time.increaseTo(ctx.start + 6n * MONTH + 12n * MONTH); // halfway through linear
      expect(await ctx.vault.vestedAmount(id)).to.equal(total / 2n);
      expect(await ctx.vault.lockedAmount(id)).to.equal(total / 2n);
      expect(await ctx.vault.releasableAmount(id)).to.equal(total / 2n);

      await time.increaseTo(ctx.start + 30n * MONTH);
      expect(await ctx.vault.vestedAmount(id)).to.equal(total);

      await time.increaseTo(ctx.start + 100n * MONTH);
      expect(await ctx.vault.vestedAmount(id)).to.equal(total);
      expect(await ctx.vault.lockedAmount(id)).to.equal(0n);
    });

    it("initial unlock (TGE) + cliff + linear", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("10000");
      const initial = (total * 1000n) / BPS; // 10 %
      const { id } = await create(ctx, { total, cliff: 3n * MONTH, duration: 9n * MONTH, initialBps: 1000n });

      expect(await ctx.vault.vestedAmountAt(id, ctx.start - 1n)).to.equal(0n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start)).to.equal(initial);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 3n * MONTH - 1n)).to.equal(initial);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 3n * MONTH)).to.equal(initial);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 3n * MONTH + 3n * MONTH)).to.equal(initial + (total - initial) / 3n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 12n * MONTH)).to.equal(total);
    });

    it("pure lock-up: zero vesting duration unlocks everything at cliff end", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("500");
      const { id } = await create(ctx, { total, cliff: 12n * MONTH, duration: 0n });
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 12n * MONTH - 1n)).to.equal(0n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 12n * MONTH)).to.equal(total);
    });

    it("zero cliff and zero vesting unlock everything at start even with 0 % TGE", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("500");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 0n, initialBps: 0n });
      expect(await ctx.vault.vestedAmountAt(id, ctx.start - 1n)).to.equal(0n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start)).to.equal(total);
    });

    it("fully unlocked at start when initialUnlockBps = 10000", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("500");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 0n, initialBps: 10_000n });
      expect(await ctx.vault.vestedAmountAt(id, ctx.start - 1n)).to.equal(0n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start)).to.equal(total);
    });

    it("linear with no cliff starts vesting immediately at start", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1200");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 12n * MONTH });
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 1n * MONTH)).to.equal(total / 12n);
    });
  });

  describe("release", function () {
    it("anyone can trigger release; tokens go to beneficiary; accounting updates", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("2400");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 24n * MONTH });

      await time.setNextBlockTimestamp(ctx.start + 6n * MONTH);
      const expected = total / 4n;
      await expect(ctx.vault.connect(ctx.stranger).release(id))
        .to.emit(ctx.vault, "TokensReleased")
        .withArgs(id, ctx.team.address, expected);

      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(expected);
      expect(await ctx.vault.releasedAmount(id)).to.equal(expected);
      expect(await ctx.vault.releasableAmount(id)).to.equal(0n);
      expect(await ctx.vault.totalCommitted()).to.equal(total - expected);

      await time.setNextBlockTimestamp(ctx.start + 24n * MONTH);
      await ctx.vault.release(id);
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(total);
      expect(await ctx.vault.totalCommitted()).to.equal(0n);
      expect(await ctx.token.balanceOf(await ctx.vault.getAddress())).to.equal(0n);
    });

    it("reverts before anything vests and for unknown ids", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { id } = await create(ctx);
      await expect(ctx.vault.release(id)).to.be.revertedWithCustomError(ctx.vault, "NothingToRelease");
      await expect(ctx.vault.release(99n)).to.be.revertedWithCustomError(ctx.vault, "UnknownSchedule").withArgs(99n);
    });

    it("schedules are independent (different allocations, different terms)", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const teamTotal = ethers.parseEther("1000");
      const mktTotal = ethers.parseEther("400");
      const { id: teamId } = await create(ctx, { label: "Team", total: teamTotal, cliff: 12n * MONTH, duration: 24n * MONTH });
      const { id: mktId } = await create(ctx, {
        beneficiary: ctx.marketing.address,
        label: "Marketing",
        total: mktTotal,
        cliff: 1n * MONTH,
        duration: 12n * MONTH,
        initialBps: 2500n,
      });

      await time.increaseTo(ctx.start);
      expect(await ctx.vault.releasableAmount(teamId)).to.equal(0n);
      expect(await ctx.vault.releasableAmount(mktId)).to.equal(mktTotal / 4n);
      await ctx.vault.release(mktId); // still inside marketing cliff: only the 25 % TGE unlock is releasable
      expect(await ctx.token.balanceOf(ctx.marketing.address)).to.equal(mktTotal / 4n);
      expect(await ctx.vault.totalCommitted()).to.equal(teamTotal + mktTotal - mktTotal / 4n);
    });
  });

  describe("revoke", function () {
    it("non-revocable schedules can never be revoked", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { id } = await create(ctx, { revocable: false });
      await expect(ctx.vault.connect(ctx.foundation).revoke(id)).to.be.revertedWithCustomError(ctx.vault, "NotRevocable");
    });

    it("only owner may revoke", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { id } = await create(ctx, { revocable: true });
      await expect(ctx.vault.connect(ctx.team).revoke(id)).to.be.revertedWithCustomError(ctx.vault, "OwnableUnauthorizedAccount");
    });

    it("keeps vested part for beneficiary, refunds unvested to owner, freezes schedule", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1000");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 10n * MONTH, revocable: true });

      await time.setNextBlockTimestamp(ctx.start + 4n * MONTH);
      const vested = (total * 4n) / 10n;
      const refund = total - vested;
      const before = await ctx.token.balanceOf(ctx.foundation.address);

      await expect(ctx.vault.connect(ctx.foundation).revoke(id)).to.emit(ctx.vault, "ScheduleRevoked").withArgs(id, vested, refund);

      expect(await ctx.token.balanceOf(ctx.foundation.address)).to.equal(before + refund);
      expect(await ctx.vault.totalCommitted()).to.equal(vested);
      const s = await ctx.vault.getSchedule(id);
      expect(s.revoked).to.equal(true);
      expect(s.revokedAt).to.equal(ctx.start + 4n * MONTH);
      expect(s.total).to.equal(total); // original allocation preserved
      expect(await ctx.vault.outstandingAmount(id)).to.equal(vested);

      // Historical queries still follow the original curve; later ones are frozen.
      expect(await ctx.vault.vestedAmountAt(id, ctx.start - 1n)).to.equal(0n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 2n * MONTH)).to.equal(total / 5n);
      expect(await ctx.vault.vestedAmountAt(id, ctx.start + 9n * MONTH)).to.equal(vested);

      // Vested part remains claimable, and does not grow anymore.
      await time.increaseTo(ctx.start + 20n * MONTH);
      expect(await ctx.vault.vestedAmount(id)).to.equal(vested);
      expect(await ctx.vault.lockedAmount(id)).to.equal(0n);
      await ctx.vault.release(id);
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(vested);
      expect(await ctx.vault.totalCommitted()).to.equal(0n);

      await expect(ctx.vault.connect(ctx.foundation).revoke(id)).to.be.revertedWithCustomError(ctx.vault, "AlreadyRevoked");
    });

    it("revoke before start refunds everything; beneficiary gets nothing", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1000");
      const { id } = await create(ctx, { total, initialBps: 1000n, revocable: true });
      const before = await ctx.token.balanceOf(ctx.foundation.address);
      await expect(ctx.vault.connect(ctx.foundation).revoke(id)).to.emit(ctx.vault, "ScheduleRevoked").withArgs(id, 0n, total);
      expect(await ctx.token.balanceOf(ctx.foundation.address)).to.equal(before + total);
      expect(await ctx.vault.totalCommitted()).to.equal(0n);
      await expect(ctx.vault.release(id)).to.be.revertedWithCustomError(ctx.vault, "NothingToRelease");
      await time.increaseTo(ctx.start + 100n * MONTH);
      expect(await ctx.vault.vestedAmount(id)).to.equal(0n);
      expect(await ctx.vault.outstandingAmount(id)).to.equal(0n);
      expect(await ctx.vault.lockedAmount(id)).to.equal(0n);
    });

    it("revoke after full vesting refunds nothing and does not transfer", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1000");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 1n * MONTH, revocable: true });
      await time.increaseTo(ctx.start + 2n * MONTH);
      await expect(ctx.vault.connect(ctx.foundation).revoke(id))
        .to.emit(ctx.vault, "ScheduleRevoked").withArgs(id, total, 0n)
        .and.to.not.emit(ctx.token, "Transfer");
      await ctx.vault.release(id);
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(total);
      await expect(ctx.vault.release(id)).to.be.revertedWithCustomError(ctx.vault, "NothingToRelease");
    });

    it("revoke keeps TGE unlock during cliff", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1000");
      const { id } = await create(ctx, { total, initialBps: 1500n, cliff: 6n * MONTH, duration: 6n * MONTH, revocable: true });
      await time.increaseTo(ctx.start + 1n * MONTH);
      const tge = (total * 1500n) / BPS;
      await expect(ctx.vault.connect(ctx.foundation).revoke(id)).to.emit(ctx.vault, "ScheduleRevoked").withArgs(id, tge, total - tge);
      await ctx.vault.release(id);
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(tge);
    });

    it("revoke after partial release accounts correctly", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("1000");
      const { id } = await create(ctx, { total, cliff: 0n, duration: 10n * MONTH, revocable: true });

      await time.setNextBlockTimestamp(ctx.start + 2n * MONTH);
      await ctx.vault.release(id); // 200 released
      const released = await ctx.vault.releasedAmount(id);
      expect(released).to.equal(total / 5n);

      await time.setNextBlockTimestamp(ctx.start + 5n * MONTH);
      await ctx.vault.connect(ctx.foundation).revoke(id); // vested 500, refund 500
      expect(await ctx.vault.releasableAmount(id)).to.equal(total / 2n - released);
      await ctx.vault.release(id);
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(total / 2n);
      expect(await ctx.token.balanceOf(await ctx.vault.getAddress())).to.equal(0n);
    });
  });

  describe("changeBeneficiary", function () {
    it("only current beneficiary can rotate its address; index updated", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { id } = await create(ctx, { cliff: 0n, duration: 10n * MONTH });
      await create(ctx, { label: "Team-2" }); // second schedule for same beneficiary

      await expect(ctx.vault.connect(ctx.foundation).changeBeneficiary(id, ctx.other.address)).to.be.revertedWithCustomError(ctx.vault, "NotBeneficiary");
      await expect(ctx.vault.connect(ctx.team).changeBeneficiary(id, ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.vault, "ZeroAddress");
      await expect(ctx.vault.connect(ctx.team).changeBeneficiary(id, await ctx.vault.getAddress())).to.be.revertedWithCustomError(ctx.vault, "InvalidBeneficiary");
      await expect(ctx.vault.connect(ctx.team).changeBeneficiary(id, ctx.team.address)).to.be.revertedWithCustomError(ctx.vault, "InvalidBeneficiary");

      await expect(ctx.vault.connect(ctx.team).changeBeneficiary(id, ctx.other.address))
        .to.emit(ctx.vault, "BeneficiaryChanged")
        .withArgs(id, ctx.team.address, ctx.other.address);

      expect(await ctx.vault.schedulesOf(ctx.team.address)).to.deep.equal([1n]);
      expect(await ctx.vault.schedulesOf(ctx.other.address)).to.deep.equal([0n]);

      await time.increaseTo(ctx.start + 10n * MONTH);
      await ctx.vault.release(id);
      expect(await ctx.token.balanceOf(ctx.other.address)).to.equal(ethers.parseEther("1000000"));
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(0n);
    });
  });

  describe("owner safety valves", function () {
    it("withdrawUnallocated only moves tokens not backing schedules", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const total = ethers.parseEther("100");
      await create(ctx, { total });
      const vaultAddr = await ctx.vault.getAddress();

      await expect(ctx.vault.connect(ctx.foundation).withdrawUnallocated(ctx.other.address)).to.be.revertedWithCustomError(ctx.vault, "ZeroAmount");
      await expect(ctx.vault.connect(ctx.foundation).withdrawUnallocated(ethers.ZeroAddress)).to.be.revertedWithCustomError(ctx.vault, "ZeroAddress");

      const stray = ethers.parseEther("7");
      await ctx.token.connect(ctx.foundation).transfer(vaultAddr, stray);
      expect(await ctx.vault.unallocated()).to.equal(stray);

      await expect(ctx.vault.connect(ctx.stranger).withdrawUnallocated(ctx.stranger.address)).to.be.revertedWithCustomError(ctx.vault, "OwnableUnauthorizedAccount");
      await expect(ctx.vault.connect(ctx.foundation).withdrawUnallocated(ctx.other.address))
        .to.emit(ctx.vault, "UnallocatedWithdrawn").withArgs(ctx.other.address, stray);
      expect(await ctx.token.balanceOf(ctx.other.address)).to.equal(stray);
      expect(await ctx.token.balanceOf(vaultAddr)).to.equal(total);
      expect(await ctx.vault.totalCommitted()).to.equal(total);
    });

    it("recoverERC20 refuses the vault token, allows other tokens", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const vaultAddr = await ctx.vault.getAddress();
      await expect(ctx.vault.connect(ctx.foundation).recoverERC20(await ctx.token.getAddress(), ctx.other.address, 1n)).to.be.revertedWithCustomError(ctx.vault, "CannotRecoverVaultToken");

      const otherToken = await ethers.deployContract("HVXToken", [ctx.foundation.address]); // any ERC-20 works
      await expect(ctx.vault.connect(ctx.foundation).recoverERC20(await otherToken.getAddress(), ethers.ZeroAddress, 1n)).to.be.revertedWithCustomError(ctx.vault, "ZeroAddress");
      await otherToken.connect(ctx.foundation).transfer(vaultAddr, 5n);
      await expect(ctx.vault.connect(ctx.foundation).recoverERC20(await otherToken.getAddress(), ctx.other.address, 5n)).to.changeTokenBalances(ethers, otherToken, [vaultAddr, ctx.other], [-5n, 5n]);
    });

    it("ownership is two-step and can be renounced; releases keep working afterwards", async function () {
      const ctx = await networkHelpers.loadFixture(deploy);
      const { id } = await create(ctx, { cliff: 0n, duration: 1n * MONTH });

      await ctx.vault.connect(ctx.foundation).transferOwnership(ctx.other.address);
      expect(await ctx.vault.owner()).to.equal(ctx.foundation.address); // not yet
      await ctx.vault.connect(ctx.other).acceptOwnership();
      expect(await ctx.vault.owner()).to.equal(ctx.other.address);

      await ctx.vault.connect(ctx.other).renounceOwnership();
      expect(await ctx.vault.owner()).to.equal(ethers.ZeroAddress);

      await time.increaseTo(ctx.start + 1n * MONTH);
      await ctx.vault.connect(ctx.stranger).release(id);
      expect(await ctx.token.balanceOf(ctx.team.address)).to.equal(ethers.parseEther("1000000"));
    });
  });
});
