// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title HVX Vesting Vault
 * @notice Holds HVX and releases vested tokens to each schedule's beneficiary.
 * @dev The owner funds schedules with fixed amounts and vesting terms. Beneficiaries can transfer
 * their schedules. The owner can revoke revocable schedules and reclaim only unvested tokens.
 * Anyone can release vested tokens; only the owner can withdraw unallocated tokens.
 */
contract HVXVestingVault is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant BPS_DENOMINATOR = 10_000;

    struct Schedule {
        address beneficiary;
        string label; // Allocation name, e.g. "Team".
        uint256 total; // Original allocation, including any tokens later refunded.
        uint256 released;
        uint64 start;
        uint64 cliffDuration;
        uint64 vestingDuration;
        uint64 revokedAt; // Vesting cutoff when revoked.
        uint16 initialUnlockBps;
        bool revocable;
        bool revoked;
    }

    IERC20 public immutable token;

    Schedule[] private _schedules;
    mapping(address beneficiary => uint256[] scheduleIds) private _scheduleIdsByBeneficiary;

    /// @notice Tokens still owed across all schedules, including tokens that have not vested yet.
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

    /**
     * @notice Creates a schedule funded by the owner, who must first approve the vault to spend `total` HVX.
     * @param start Unix timestamp of the initial unlock. May be in the past.
     * @param cliffDuration Seconds after start before the remaining tokens begin vesting.
     * @param vestingDuration Seconds of linear vesting after the cliff. Zero unlocks the remainder at cliff end.
     * @param initialUnlockBps Share of total unlocked at start, in basis points (10,000 = 100%).
     * @param revocable Whether the owner can stop vesting and reclaim unvested tokens.
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
        Schedule storage schedule = _schedules.push();
        schedule.beneficiary = beneficiary;
        schedule.label = label;
        schedule.total = total;
        schedule.start = start;
        schedule.cliffDuration = cliffDuration;
        schedule.vestingDuration = vestingDuration;
        schedule.initialUnlockBps = initialUnlockBps;
        schedule.revocable = revocable;
        _scheduleIdsByBeneficiary[beneficiary].push(id);
        totalCommitted += total;

        emit ScheduleCreated(
            id, beneficiary, label, total, start, cliffDuration, vestingDuration, initialUnlockBps, revocable
        );

        token.safeTransferFrom(msg.sender, address(this), total);
    }

    /// @notice Stops vesting and refunds unvested tokens to the owner. Vested tokens remain claimable.
    function revoke(uint256 id) external onlyOwner {
        Schedule storage schedule = _getSchedule(id);
        if (!schedule.revocable) revert NotRevocable();
        if (schedule.revoked) revert AlreadyRevoked();

        uint64 revokedAt = uint64(block.timestamp);
        uint256 vestedTotal = _vestedAmount(schedule, revokedAt);
        uint256 refundAmount = schedule.total - vestedTotal;

        schedule.revoked = true;
        schedule.revokedAt = revokedAt;
        totalCommitted -= refundAmount;

        emit ScheduleRevoked(id, vestedTotal, refundAmount);

        // slither-disable-next-line timestamp
        if (refundAmount > 0) token.safeTransfer(msg.sender, refundAmount);
    }

    /// @notice Withdraws all HVX not reserved for schedules to `to`.
    function withdrawUnallocated(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = unallocated();
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) revert ZeroAmount();
        emit UnallocatedWithdrawn(to, amount);
        token.safeTransfer(to, amount);
    }

    /// @notice Recovers tokens other than the vault's HVX token to `to`.
    function recoverERC20(IERC20 otherToken, address to, uint256 amount) external onlyOwner {
        if (otherToken == token) revert CannotRecoverVaultToken();
        if (to == address(0)) revert ZeroAddress();
        otherToken.safeTransfer(to, amount);
    }

    /// @notice Pays all claimable tokens to the beneficiary. Anyone may call.
    function release(uint256 id) external {
        Schedule storage schedule = _getSchedule(id);
        uint256 amount = _vestedAmount(schedule, uint64(block.timestamp)) - schedule.released;
        // slither-disable-next-line incorrect-equality,timestamp
        if (amount == 0) revert NothingToRelease();

        schedule.released += amount;
        totalCommitted -= amount;

        emit TokensReleased(id, schedule.beneficiary, amount);
        token.safeTransfer(schedule.beneficiary, amount);
    }

    /// @notice Transfers the caller's schedule to a new beneficiary.
    function changeBeneficiary(uint256 id, address newBeneficiary) external {
        Schedule storage schedule = _getSchedule(id);
        if (msg.sender != schedule.beneficiary) revert NotBeneficiary();
        if (newBeneficiary == schedule.beneficiary) revert InvalidBeneficiary();
        _checkBeneficiary(newBeneficiary);

        address previousBeneficiary = schedule.beneficiary;
        schedule.beneficiary = newBeneficiary;
        _removeBeneficiaryScheduleId(previousBeneficiary, id);
        _scheduleIdsByBeneficiary[newBeneficiary].push(id);

        emit BeneficiaryChanged(id, previousBeneficiary, newBeneficiary);
    }

    function scheduleCount() external view returns (uint256) {
        return _schedules.length;
    }

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return _getSchedule(id);
    }

    /// @notice Schedule IDs for the beneficiary. Order may change after a beneficiary transfer.
    function schedulesOf(address beneficiary) external view returns (uint256[] memory) {
        return _scheduleIdsByBeneficiary[beneficiary];
    }

    /// @notice Tokens vested so far, including tokens already released.
    function vestedAmount(uint256 id) external view returns (uint256) {
        return _vestedAmount(_getSchedule(id), uint64(block.timestamp));
    }

    function vestedAmountAt(uint256 id, uint64 timestamp) external view returns (uint256) {
        return _vestedAmount(_getSchedule(id), timestamp);
    }

    function releasableAmount(uint256 id) external view returns (uint256) {
        Schedule storage schedule = _getSchedule(id);
        return _vestedAmount(schedule, uint64(block.timestamp)) - schedule.released;
    }

    /// @notice Unvested tokens. Zero after revocation because those tokens were refunded.
    function lockedAmount(uint256 id) external view returns (uint256) {
        Schedule storage schedule = _getSchedule(id);
        if (schedule.revoked) return 0;
        return schedule.total - _vestedAmount(schedule, uint64(block.timestamp));
    }

    /// @notice Tokens still owed to this schedule, excluding released and refunded tokens.
    function outstandingAmount(uint256 id) external view returns (uint256) {
        Schedule storage schedule = _getSchedule(id);
        uint256 totalEntitlement = schedule.revoked ? _vestedAmount(schedule, schedule.revokedAt) : schedule.total;
        return totalEntitlement - schedule.released;
    }

    function releasedAmount(uint256 id) external view returns (uint256) {
        return _getSchedule(id).released;
    }

    /// @notice Scheduled vesting end, unchanged by revocation.
    function vestingEnd(uint256 id) external view returns (uint64) {
        Schedule storage schedule = _getSchedule(id);
        return schedule.start + schedule.cliffDuration + schedule.vestingDuration;
    }

    /// @notice HVX held by the vault that is not reserved for schedules.
    function unallocated() public view returns (uint256) {
        uint256 balance = token.balanceOf(address(this));
        // slither-disable-next-line timestamp
        return balance > totalCommitted ? balance - totalCommitted : 0;
    }

    function _checkBeneficiary(address beneficiary) private view {
        if (beneficiary == address(0)) revert ZeroAddress();
        if (beneficiary == address(this) || beneficiary == address(token)) revert InvalidBeneficiary();
    }

    function _getSchedule(uint256 id) private view returns (Schedule storage) {
        if (id >= _schedules.length) revert UnknownSchedule(id);
        return _schedules[id];
    }

    /// @dev Caps vesting at revocation while preserving queries for earlier timestamps.
    // slither-disable-start timestamp
    function _vestedAmount(Schedule storage schedule, uint64 timestamp) private view returns (uint256) {
        if (schedule.revoked && timestamp > schedule.revokedAt) timestamp = schedule.revokedAt;
        if (timestamp < schedule.start) return 0;

        uint256 totalAllocation = schedule.total;
        uint256 initialUnlock = (totalAllocation * schedule.initialUnlockBps) / BPS_DENOMINATOR;
        uint64 cliffEnd = schedule.start + schedule.cliffDuration;
        if (timestamp < cliffEnd) return initialUnlock;

        uint256 elapsedSinceCliff = timestamp - cliffEnd;
        if (elapsedSinceCliff >= schedule.vestingDuration) return totalAllocation;

        return initialUnlock + ((totalAllocation - initialUnlock) * elapsedSinceCliff) / schedule.vestingDuration;
    }
    // slither-disable-end timestamp

    function _removeBeneficiaryScheduleId(address beneficiary, uint256 id) private {
        uint256[] storage scheduleIds = _scheduleIdsByBeneficiary[beneficiary];
        uint256 scheduleIdsLength = scheduleIds.length;
        for (uint256 i = 0; i < scheduleIdsLength; ++i) {
            if (scheduleIds[i] == id) {
                scheduleIds[i] = scheduleIds[scheduleIdsLength - 1];
                scheduleIds.pop();
                return;
            }
        }
    }
}
