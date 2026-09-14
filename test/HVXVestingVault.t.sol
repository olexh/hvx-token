// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {HVXToken} from "../contracts/HVXToken.sol";
import {HVXVestingVault} from "../contracts/HVXVestingVault.sol";

/// Property / fuzz tests for the vesting math and accounting invariants.
contract HVXVestingVaultFuzz is Test {
    HVXToken token;
    HVXVestingVault vault;
    address owner = address(0xA11CE);
    address beneficiary = address(0xB0B);

    uint256 constant MAX_TOTAL = 100_000_000_000e18;
    uint64 constant MAX_DURATION = 20 * 365 days;

    function setUp() public {
        token = new HVXToken(owner);
        vault = new HVXVestingVault(token, owner);
        vm.prank(owner);
        token.approve(address(vault), type(uint256).max);
    }

    function _create(uint256 total, uint64 start, uint64 cliff, uint64 duration, uint16 bps, bool revocable)
        internal
        returns (uint256 id)
    {
        vm.prank(owner);
        id = vault.createSchedule(beneficiary, "fuzz", total, start, cliff, duration, bps, revocable);
    }

    function _bound(uint256 total, uint64 start, uint64 cliff, uint64 duration, uint16 bps)
        internal
        pure
        returns (uint256, uint64, uint64, uint64, uint16)
    {
        total = bound(total, 1, MAX_TOTAL);
        start = uint64(bound(start, 1, 4_000_000_000));
        cliff = uint64(bound(cliff, 0, MAX_DURATION));
        duration = uint64(bound(duration, 0, MAX_DURATION));
        bps = uint16(bound(bps, 0, 10_000));
        return (total, start, cliff, duration, bps);
    }

    /// vested(t) is monotonic non-decreasing, bounded by total, 0 before start, total at end.
    function testFuzz_vestingCurve(uint256 total, uint64 start, uint64 cliff, uint64 duration, uint16 bps, uint64 t1, uint64 t2)
        public
    {
        (total, start, cliff, duration, bps) = _bound(total, start, cliff, duration, bps);
        uint256 id = _create(total, start, cliff, duration, bps, false);

        if (t1 > t2) (t1, t2) = (t2, t1);
        assertLe(vault.vestedAmountAt(id, t1), vault.vestedAmountAt(id, t2), "monotonic");
        assertLe(vault.vestedAmountAt(id, t2), total, "bounded");
        _checkBoundaries(id, total, start, cliff, duration, bps);
    }

    function _checkBoundaries(uint256 id, uint256 total, uint64 start, uint64 cliff, uint64 duration, uint16 bps) internal view {
        uint256 initial = (total * bps) / 10_000;
        assertEq(vault.vestedAmountAt(id, start - 1), 0, "zero before start");
        assertEq(vault.vestedAmountAt(id, start), (cliff == 0 && duration == 0) ? total : initial, "unlock at start");
        assertEq(vault.vestedAmountAt(id, start + cliff + duration), total, "full at end");
        assertEq(vault.vestedAmountAt(id, type(uint64).max), total, "full forever after");
        if (cliff > 0) assertEq(vault.vestedAmountAt(id, start + cliff - 1), initial, "flat during cliff");
    }

    /// Releasing at arbitrary times always sums to exactly total; totalCommitted tracks it.
    function testFuzz_releaseSumsToTotal(uint256 total, uint64 start, uint64 cliff, uint64 duration, uint16 bps, uint64[8] memory times)
        public
    {
        (total, start, cliff, duration, bps) = _bound(total, start, cliff, duration, bps);
        uint256 id = _create(total, start, cliff, duration, bps, false);
        uint64 end = start + cliff + duration;

        uint256 releasedSum;
        uint64 now_ = 1;
        for (uint256 i = 0; i < times.length; i++) {
            now_ += uint64(bound(times[i], 0, MAX_DURATION));
            vm.warp(now_);
            uint256 r = vault.releasableAmount(id);
            if (r > 0) {
                vault.release(id);
                releasedSum += r;
            }
            assertEq(vault.releasedAmount(id), releasedSum);
            assertEq(vault.totalCommitted(), total - releasedSum, "committed invariant");
            assertEq(token.balanceOf(address(vault)), total - releasedSum, "balance invariant");
            assertLe(releasedSum, total);
        }

        vm.warp(uint256(end) + 1);
        if (vault.releasableAmount(id) > 0) vault.release(id);
        assertEq(token.balanceOf(beneficiary), total, "beneficiary gets exactly total");
        assertEq(vault.totalCommitted(), 0);
        assertEq(vault.unallocated(), 0);
    }

    /// Revoking at any time: beneficiary ends with vested-at-revoke, owner gets the rest, nothing lost.
    function testFuzz_revokeConservesTokens(uint256 total, uint64 start, uint64 cliff, uint64 duration, uint16 bps, uint64 tRelease, uint64 tRevoke)
        public
    {
        (total, start, cliff, duration, bps) = _bound(total, start, cliff, duration, bps);
        uint256 id = _create(total, start, cliff, duration, bps, true);
        tRelease = uint64(bound(tRelease, 1, 5_000_000_000));
        tRevoke = uint64(bound(tRevoke, tRelease, 5_000_000_000));

        vm.warp(tRelease);
        if (vault.releasableAmount(id) > 0) vault.release(id);

        // Snapshot the curve at several points before revoking; they must not change afterwards.
        uint64[4] memory hist = [start - 1, start, start + cliff + duration / 2, tRelease];
        uint256[4] memory before;
        for (uint256 i = 0; i < hist.length; i++) before[i] = vault.vestedAmountAt(id, hist[i]);

        vm.warp(tRevoke);
        uint256 vested = vault.vestedAmount(id);
        uint256 ownerBefore = token.balanceOf(owner);
        vm.prank(owner);
        vault.revoke(id);

        assertEq(token.balanceOf(owner) - ownerBefore, total - vested, "refund = unvested");
        assertEq(vault.lockedAmount(id), 0);
        assertEq(vault.vestedAmountAt(id, type(uint64).max), vested, "frozen");
        assertEq(vault.getSchedule(id).total, total, "original total kept");
        assertEq(vault.getSchedule(id).revokedAt, tRevoke, "revokedAt recorded");
        for (uint256 i = 0; i < hist.length; i++) {
            uint256 expected = hist[i] <= tRevoke ? before[i] : vested;
            assertEq(vault.vestedAmountAt(id, hist[i]), expected, "history unchanged by revoke");
        }
        assertEq(vault.outstandingAmount(id), vested - vault.releasedAmount(id), "outstanding");

        if (vault.releasableAmount(id) > 0) vault.release(id);
        assertEq(token.balanceOf(beneficiary), vested, "beneficiary keeps vested");
        assertEq(token.balanceOf(address(vault)), 0, "vault empty");
        assertEq(vault.totalCommitted(), 0);
    }

    /// Many schedules: committed always equals sum of outstanding and vault is never under-collateralised.
    function testFuzz_multiScheduleInvariant(uint256[5] memory totals, uint64 t) public {
        uint256 sum;
        for (uint256 i = 0; i < totals.length; i++) {
            uint256 tot = bound(totals[i], 1, MAX_TOTAL / 5);
            sum += tot;
            _create(tot, uint64(1000 + i * 100), uint64(i * 30 days), uint64(i * 365 days), uint16(i * 1000), i % 2 == 0);
        }
        assertEq(vault.totalCommitted(), sum);

        vm.warp(bound(t, 1, 10 * 365 days));
        uint256 released;
        for (uint256 i = 0; i < totals.length; i++) {
            if (vault.releasableAmount(i) > 0) {
                released += vault.releasableAmount(i);
                vault.release(i);
            }
        }
        assertEq(vault.totalCommitted(), sum - released);
        assertGe(token.balanceOf(address(vault)), vault.totalCommitted(), "collateralised");
        assertEq(vault.unallocated(), 0);
    }
}
