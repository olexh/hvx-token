import { readFileSync } from "node:fs";
import { expect } from "chai";
import { network } from "hardhat";
import tokenArtifact from "../artifacts/contracts/HVXToken.sol/HVXToken.json" with { type: "json" };
import vaultArtifact from "../artifacts/contracts/HVXVestingVault.sol/HVXVestingVault.json" with { type: "json" };
// @ts-ignore plain ES module shared with the browser page
import * as app from "../demo/safe/blockdeal.js";

const { ethers, networkHelpers } = await network.create();
const { time } = networkHelpers;

const HVX = (n: string) => ethers.parseUnits(n, 18);
const iso = (ts: number) => new Date(ts * 1000).toISOString();

describe("Block deal Safe App (demo/safe)", function () {
  describe("config", function () {
    for (const [file, chainId] of [["bsc", 56], ["bscTestnet", 97]] as const) {
      it(`NETWORKS[${chainId}] matches deployments/${file}`, function () {
        const d = JSON.parse(readFileSync(`deployments/${file}.json`, "utf8"));
        const s = JSON.parse(readFileSync(`deployments/${file}.safe.json`, "utf8"));
        const net = app.NETWORKS[chainId];
        expect(d.chainId).to.equal(chainId);
        expect(net.token).to.equal(d.HVXToken);
        expect(net.vault).to.equal(d.HVXVestingVault);
        expect(net.safe).to.equal(s.safeAddress);
      });
    }

    it("ABI fragments match the compiled contracts", function () {
      for (const [frags, artifact] of [[app.TOKEN_ABI, tokenArtifact], [app.VAULT_ABI, vaultArtifact]] as const) {
        const real = new ethers.Interface(artifact.abi);
        for (const frag of frags) {
          const f = ethers.FunctionFragment.from(frag);
          expect(f.format("minimal"), `${f.name} drifted`).to.equal(real.getFunction(f.name)!.format("minimal"));
        }
      }
    });

    it("manifest lists name, description and an existing icon", function () {
      const m = JSON.parse(readFileSync("demo/safe/manifest.json", "utf8"));
      expect(m.name).to.be.a("string").and.not.empty;
      expect(m.description).to.be.a("string").and.not.empty;
      expect(readFileSync(`demo/safe/${m.iconPath}`, "utf8")).to.include("<svg");
    });
  });

  describe("input checks", function () {
    const net = app.NETWORKS[56];
    const now = Date.parse("2026-10-06T12:00:00Z") / 1000;
    const buyer = "0x1111111111111111111111111111111111111111";
    const base = { name: "Buyer A", wallet: buyer, amount: "100,000,000", unlockDate: "2027-10-06", unlockTime: "00:00", unlockPercent: "100", vestingMonths: "12", pauseMonths: "0" };
    const build = (over: object = {}) => app.buildSchedule(ethers, { ...base, ...over }, net, net.safe, now);

    it("builds a full unlock after a 12-month lock-up", function () {
      const { errors, schedule } = build();
      expect(errors).to.deep.equal({});
      expect(schedule.label).to.equal("Block deal - Buyer A");
      expect(schedule.total).to.equal(HVX("100000000"));
      expect(iso(Number(schedule.start))).to.equal("2027-10-06T00:00:00.000Z");
      expect(schedule.cliffDuration).to.equal(0n);
      expect(schedule.vestingDuration).to.equal(0n);
      expect(schedule.initialUnlockBps).to.equal(10_000);
      expect(schedule.revocable).to.equal(false);
    });

    it("ignores vesting fields at 100% and uses calendar months otherwise", function () {
      expect(build({ vestingMonths: "abc" }).errors).to.deep.equal({});
      const { schedule } = build({ unlockDate: "2027-04-06", unlockPercent: "20", vestingMonths: "12", pauseMonths: "3" });
      expect(schedule.initialUnlockBps).to.equal(2000);
      const cliffEnd = Number(schedule.start + schedule.cliffDuration);
      expect(iso(cliffEnd)).to.equal("2027-07-06T00:00:00.000Z");
      expect(iso(cliffEnd + Number(schedule.vestingDuration))).to.equal("2028-07-06T00:00:00.000Z");
    });

    it("clamps month ends", function () {
      expect(iso(app.addMonthsUTC(Date.parse("2027-01-31T00:00:00Z") / 1000, 1))).to.equal("2027-02-28T00:00:00.000Z");
      expect(iso(app.addMonthsUTC(Date.parse("2027-08-31T10:30:00Z") / 1000, 6))).to.equal("2028-02-29T10:30:00.000Z");
    });

    it("rejects bad input field by field", function () {
      expect(build({ name: " " }).errors).to.have.keys("name");
      expect(build({ wallet: "0x123" }).errors).to.have.keys("wallet");
      expect(build({ wallet: "0x52908400098527886E0F7030069857d2E4169EE7" }).errors.wallet).to.match(/checksum/);
      expect(build({ wallet: ethers.ZeroAddress }).errors).to.have.keys("wallet");
      expect(build({ wallet: net.vault.toLowerCase() }).errors.wallet).to.match(/vault/);
      expect(build({ wallet: net.token }).errors.wallet).to.match(/token/);
      expect(build({ wallet: net.safe }).errors.wallet).to.match(/Safe/);
      for (const amount of ["0", "-5", "1e6", "1.0000000000000000001", ""]) expect(build({ amount }).errors, amount).to.have.keys("amount");
      expect(build({ unlockDate: "2026-10-06" }).errors).to.have.keys("unlockDate");
      expect(build({ unlockDate: "" }).errors).to.have.keys("unlockDate");
      for (const unlockPercent of ["101", "-1", "12.345", ""]) expect(build({ unlockPercent }).errors, unlockPercent).to.have.keys("unlockPercent");
      expect(build({ unlockPercent: "20", vestingMonths: "0" }).errors).to.have.keys("vestingMonths");
      expect(build({ unlockPercent: "20", pauseMonths: "1.5" }).errors).to.have.keys("pauseMonths");
    });

    it("accepts lowercase addresses and decimals", function () {
      const { schedule } = build({ wallet: "0x52908400098527886e0f7030069857d2e4169ee7", amount: "1 500.25", unlockPercent: "12.5" });
      expect(schedule.beneficiary).to.equal("0x52908400098527886E0F7030069857D2E4169EE7");
      expect(schedule.total).to.equal(HVX("1500.25"));
      expect(schedule.initialUnlockBps).to.equal(1250);
    });

    it("describes the schedule in plain English", function () {
      expect(app.describeSchedule(ethers, build().schedule)).to.deep.equal([
        "Nothing can be claimed before 6 Oct 2027, 00:00 UTC.",
        "On 6 Oct 2027, 00:00 UTC all 100,000,000 HVX become claimable.",
        "The Foundation can't cancel this schedule, change it or release tokens early.",
      ]);
      const lines = app.describeSchedule(ethers, build({ unlockPercent: "20", pauseMonths: "1" }).schedule);
      expect(lines[1]).to.equal("On 6 Oct 2027, 00:00 UTC 20,000,000 HVX (20%) become claimable.");
      expect(lines[2]).to.equal("Nothing more until 6 Nov 2027, 00:00 UTC.");
      expect(lines[3]).to.equal("The remaining 80,000,000 HVX are released gradually, every second, until 6 Nov 2028, 00:00 UTC.");
    });
  });

  describe("transactions executed by the Safe", function () {
    async function deploy() {
      const [safe, buyerA, buyerB, stranger] = await ethers.getSigners();
      const token = await ethers.deployContract("HVXToken", [safe.address]);
      const vault = await ethers.deployContract("HVXVestingVault", [await token.getAddress(), safe.address]);
      const net = { token: await token.getAddress(), vault: await vault.getAddress() };
      return { safe, buyerA, buyerB, stranger, token, vault, net };
    }

    it("locks each buyer's HVX until unlock, then vests as described", async function () {
      const { safe, buyerA, buyerB, stranger, token, vault, net } = await networkHelpers.loadFixture(deploy);
      const now = await time.latest();
      const day = (offset: number) => new Date((now + offset * 86400) * 1000).toISOString().slice(0, 10);
      const a = app.buildSchedule(ethers, { name: "Buyer A", wallet: buyerA.address, amount: "100000000", unlockDate: day(365), unlockTime: "00:00", unlockPercent: "100" }, net, safe.address, now);
      const b = app.buildSchedule(ethers, { name: "Buyer B", wallet: buyerB.address, amount: "50000000", unlockDate: day(182), unlockTime: "00:00", unlockPercent: "20", vestingMonths: "12", pauseMonths: "0" }, net, safe.address, now);
      expect(a.errors).to.deep.equal({}); expect(b.errors).to.deep.equal({});

      const txs = app.buildTransactions(ethers, net, [a.schedule, b.schedule]);
      expect(txs).to.have.length(3);
      const file = app.txBuilderFile(ethers, 56, safe.address, [a.schedule, b.schedule], txs);
      expect(file.transactions.map((t: any) => t.data)).to.deep.equal(txs.map((t: any) => t.data));

      const safeBefore = await token.balanceOf(safe.address);
      for (const tx of txs) await (await safe.sendTransaction({ to: tx.to, data: tx.data, value: 0 })).wait();

      expect(await vault.scheduleCount()).to.equal(2n);
      expect(await token.balanceOf(net.vault)).to.equal(HVX("150000000"));
      expect(safeBefore - (await token.balanceOf(safe.address))).to.equal(HVX("150000000"));
      expect(await token.allowance(safe.address, net.vault)).to.equal(0n);

      const sa = await vault.getSchedule(0n), sb = await vault.getSchedule(1n);
      expect(sa.beneficiary).to.equal(buyerA.address);
      expect(sa.label).to.equal("Block deal - Buyer A");
      expect(sa.revocable).to.equal(false); expect(sb.revocable).to.equal(false);
      await expect(vault.connect(safe).revoke(0n)).to.be.revertedWithCustomError(vault, "NotRevocable");

      // Before Buyer B's unlock: nothing claimable for anyone.
      for (const id of [0n, 1n]) await expect(vault.connect(stranger).release(id)).to.be.revertedWithCustomError(vault, "NothingToRelease");

      // Buyer B: 20% at unlock, the rest linear over 12 calendar months.
      const bEnd = sb.start + sb.cliffDuration + sb.vestingDuration;
      expect(await vault.vestedAmountAt(1n, sb.start - 1n)).to.equal(0n);
      expect(await vault.vestedAmountAt(1n, sb.start)).to.equal(HVX("10000000"));
      expect(await vault.vestedAmountAt(1n, (sb.start + bEnd) / 2n)).to.equal(HVX("30000000"));
      expect(await vault.vestedAmountAt(1n, bEnd)).to.equal(HVX("50000000"));

      // Buyer A: nothing one second before unlock, everything at unlock.
      await time.setNextBlockTimestamp(sa.start - 1n);
      await expect(vault.connect(stranger).release(0n)).to.be.revertedWithCustomError(vault, "NothingToRelease");
      await time.setNextBlockTimestamp(sa.start);
      await vault.connect(stranger).release(0n);
      expect(await token.balanceOf(buyerA.address)).to.equal(HVX("100000000"));

      await time.increaseTo(bEnd);
      await vault.release(1n);
      expect(await token.balanceOf(buyerB.address)).to.equal(HVX("50000000"));
    });
  });
});
