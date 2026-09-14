// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/**
 * @title HiveX (HVX)
 * @notice BEP-20 token with an initial supply of 100,000,000,000 HVX.
 * @dev Mints the full supply to the treasury at deployment. No owner or further minting.
 * Holders can burn tokens directly or through an approved spender. HVXVestingVault handles vesting.
 */
contract HVXToken is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice Supply minted at deployment, before any burns.
    uint256 public constant TOTAL_SUPPLY = 100_000_000_000 * 10 ** 18;

    error ZeroAddress();

    /// @param treasury Receives the full supply. Should be the foundation multisig.
    constructor(address treasury) ERC20("HiveX", "HVX") ERC20Permit("HiveX") {
        if (treasury == address(0)) revert ZeroAddress();
        _mint(treasury, TOTAL_SUPPLY);
    }

    /// @notice Total tokens burned since deployment.
    function totalBurned() external view returns (uint256) {
        return TOTAL_SUPPLY - totalSupply();
    }
}
