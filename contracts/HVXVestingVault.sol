// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title HVX Vesting Vault
 * @notice Holds locked HVX and pays it out to beneficiaries on fixed schedules.
 *
 * Each schedule is created once by the owner (the foundation multisig) and
 * cannot be changed afterwards. The owner can revoke schedules that were
 * marked revocable at creation; only the unvested part comes back. Tokens
 * that back no schedule can be withdrawn by the owner. Nothing else is
 * owner-controlled: release() can be called by anyone and always pays the
 * schedule's beneficiary.
 *
 * Unlock curve of a schedule:
 *   before start                              nothing
 *   at start                                  initialUnlockBps of total
 *   from start + cliffDuration                linear over vestingDuration
 *   at start + cliffDuration + vestingDuration  everything
 * A vestingDuration of zero releases the remainder at the end of the cliff.
 */
contract HVXVestingVault is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Schedule {
        address beneficiary;
        string label; // allocation name, e.g. "Team"
        uint256 total; // original allocation, never changed
        uint256 released;
        uint64 start;
        uint64 cliffDuration;
        uint64 vestingDuration;
        uint64 revokedAt; // 0 while active; vesting is frozen at this time once revoked
        uint16 initialUnlockBps;
        bool revocable;
        bool revoked;
    }

    IERC20 public immutable token;

    Schedule[] private _schedules;
    mapping(address beneficiary => uint256[] ids) private _schedulesOf;

    /// @notice What the vault still owes: sum of outstandingAmount() over all schedules.
    uint256 public totalCommitted;

    event ScheduleCreated(
        uint256 indexed id,
        address indexed beneficiary,
        string label,
        uint256 total,
        uint64 start,
        uint64 cliffDuration,
        uint64 vestingDuration,
        uint16 initialUnlockBps,
        bool revocable
    );
    event TokensReleased(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event ScheduleRevoked(uint256 indexed id, uint256 vestedTotal, uint256 refunded);
    event BeneficiaryChanged(uint256 indexed id, address indexed previous, address indexed current);
    event UnallocatedWithdrawn(address indexed to, uint256 amount);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidBeneficiary();
    error InvalidSchedule();
    error UnknownSchedule(uint256 id);
    error NotBeneficiary();
    error NotRevocable();
    error AlreadyRevoked();
    error NothingToRelease();
    error CannotRecoverVaultToken();

    constructor(IERC20 token_, address initialOwner) Ownable(initialOwner) {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ------------------------------------------------------------------ owner

    /**
     * @notice Creates a schedule and pulls `total` HVX from the owner (approve first).
     * @param start            Unix time of the TGE unlock. May be in the past.
     * @param cliffDuration    Seconds after start with no further unlock.
     * @param vestingDuration  Seconds of linear unlock after the cliff. Zero = all at cliff end.
     * @param initialUnlockBps Share of total unlocked at start, in basis points.
     * @param revocable        Lets the owner revoke the unvested part later.
     */
    function createSchedule(
        address beneficiary,
        string calldata label,
        uint256 total,
        uint64 start,
        uint64 cliffDuration,
        uint64 vestingDuration,
        uint16 initialUnlockBps,
        bool revocable
    ) external onlyOwner returns (uint256 id) {
        _checkBeneficiary(beneficiary);
        if (total == 0) revert ZeroAmount();
        if (initialUnlockBps > BPS_DENOMINATOR) revert InvalidSchedule();
        if (uint256(start) + cliffDuration + vestingDuration > type(uint64).max) revert InvalidSchedule();

        id = _schedules.length;
        Schedule storage s = _schedules.push();
        s.beneficiary = beneficiary;
        s.label = label;
        s.total = total;
        s.start = start;
        s.cliffDuration = cliffDuration;
        s.vestingDuration = vestingDuration;
        s.initialUnlockBps = initialUnlockBps;
        s.revocable = revocable;
        _schedulesOf[beneficiary].push(id);
        totalCommitted += total;

        emit ScheduleCreated(
            id, beneficiary, label, total, start, cliffDuration, vestingDuration, initialUnlockBps, revocable
        );

        token.safeTransferFrom(msg.sender, address(this), total);
    }

    /// @notice Stops a revocable schedule. Vested tokens stay claimable, the rest goes back to the owner.
    function revoke(uint256 id) external onlyOwner {
        Schedule storage s = _schedule(id);
        if (!s.revocable) revert NotRevocable();
        if (s.revoked) revert AlreadyRevoked();

        uint64 now_ = uint64(block.timestamp);
        uint256 vested = _vestedAmount(s, now_);
        uint256 refund = s.total - vested;

        s.revoked = true;
        s.revokedAt = now_;
        totalCommitted -= refund;

        emit ScheduleRevoked(id, vested, refund);

        // slither-disable-next-line timestamp
        if (refund > 0) token.safeTransfer(msg.sender, refund);
    }

    /// @notice Returns HVX that was sent here directly and belongs to no schedule.
    function withdrawUnallocated(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = unallocated();
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) revert ZeroAmount();
        emit UnallocatedWithdrawn(to, amount);
        token.safeTransfer(to, amount);
    }

    /// @notice Returns some other token that was sent here by mistake.
    function recoverERC20(IERC20 otherToken, address to, uint256 amount) external onlyOwner {
        if (otherToken == token) revert CannotRecoverVaultToken();
        if (to == address(0)) revert ZeroAddress();
        otherToken.safeTransfer(to, amount);
    }

    // ------------------------------------------------------- permissionless

    /// @notice Pays out everything vested and not yet released. Anyone may call.
    function release(uint256 id) external {
        Schedule storage s = _schedule(id);
        uint256 amount = _vestedAmount(s, uint64(block.timestamp)) - s.released;
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) revert NothingToRelease();

        s.released += amount;
        totalCommitted -= amount;

        emit TokensReleased(id, s.beneficiary, amount);
        token.safeTransfer(s.beneficiary, amount);
    }

    /// @notice Lets a beneficiary move its schedule to another address.
    function changeBeneficiary(uint256 id, address newBeneficiary) external {
        Schedule storage s = _schedule(id);
        if (msg.sender != s.beneficiary) revert NotBeneficiary();
        if (newBeneficiary == s.beneficiary) revert InvalidBeneficiary();
        _checkBeneficiary(newBeneficiary);

        address previous = s.beneficiary;
        s.beneficiary = newBeneficiary;
        _removeFromIndex(previous, id);
        _schedulesOf[newBeneficiary].push(id);

        emit BeneficiaryChanged(id, previous, newBeneficiary);
    }

    // ----------------------------------------------------------------- views

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return _schedule(id);
    }

    function schedulesOf(address beneficiary) external view returns (uint256[] memory) {
        return _schedulesOf[beneficiary];
    }

    /// @notice Unlocked so far, whether released or not.
    function vestedAmount(uint256 id) external view returns (uint256) {
        return _vestedAmount(_schedule(id), uint64(block.timestamp));
    }

    function vestedAmountAt(uint256 id, uint64 timestamp) external view returns (uint256) {
        return _vestedAmount(_schedule(id), timestamp);
    }

    function releasableAmount(uint256 id) external view returns (uint256) {
        Schedule storage s = _schedule(id);
        return _vestedAmount(s, uint64(block.timestamp)) - s.released;
    }

    /// @notice Not yet unlocked. Zero once revoked, since the unvested part was returned to the owner.
    function lockedAmount(uint256 id) external view returns (uint256) {
        Schedule storage s = _schedule(id);
        if (s.revoked) return 0;
        return s.total - _vestedAmount(s, uint64(block.timestamp));
    }

    /// @notice What the vault still owes this schedule: unlocked-or-not minus released, capped at revocation.
    function outstandingAmount(uint256 id) external view returns (uint256) {
        Schedule storage s = _schedule(id);
        uint256 cap = s.revoked ? _vestedAmount(s, s.revokedAt) : s.total;
        return cap - s.released;
    }

    function releasedAmount(uint256 id) external view returns (uint256) {
        return _schedule(id).released;
    }

    function vestingEnd(uint256 id) external view returns (uint64) {
        Schedule storage s = _schedule(id);
        return s.start + s.cliffDuration + s.vestingDuration;
    }

    /// @notice HVX in the vault that belongs to no schedule.
    function unallocated() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        // slither-disable-next-line timestamp
        return balance > totalCommitted ? balance - totalCommitted : 0;
    }

    // ------------------------------------------------------------- internals

    function _checkBeneficiary(address beneficiary) private view {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == address(this) || beneficiary == address(token)) revert InvalidBeneficiary();
    }

    function _schedule(uint256 id) private view returns (Schedule storage) {
        if (id >= _schedules.length) revert UnknownSchedule(id);
        return _schedules[id];
    }

    /// @dev Original unlock curve. After a revoke the curve is frozen at revokedAt, so
    ///      historical queries (timestamp < revokedAt) still return what was vested back then.
    ///      Time-based comparisons are the purpose of this function (slither: timestamp).
    // slither-disable-start timestamp
    function _vestedAmount(Schedule storage s, uint64 timestamp) private view returns (uint256) {
        if (s.revoked && timestamp > s.revokedAt) timestamp = s.revokedAt;
        if (timestamp < s.start) return 0;

        uint256 total = s.total;
        uint256 initial = (total * s.initialUnlockBps) / BPS_DENOMINATOR;
        uint64 cliffEnd = s.start + s.cliffDuration;
        if (timestamp < cliffEnd) return initial;

        uint256 elapsed = timestamp - cliffEnd;
        if (elapsed >= s.vestingDuration) return total;

        return initial + ((total - initial) * elapsed) / s.vestingDuration;
    }
    // slither-disable-end timestamp

    function _removeFromIndex(address beneficiary, uint256 id) private {
        uint256[] storage ids = _schedulesOf[beneficiary];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; ++i) {
            if (ids[i] == id) {
                ids[i] = ids[len - 1];
                ids.pop();
                return;
            }
        }
    }
}
