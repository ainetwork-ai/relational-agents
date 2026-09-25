// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Simulator, SwapVM, AquaOpcodes, Context } from "@1inch/swap-vm/routers/AquaSwapVMRouter.sol";
import { Calldata } from "@1inch/solidity-utils/contracts/libraries/Calldata.sol";

/// @dev Argument layouts for the two family opcodes. Programs are byte
///      sequences of [opcode, argsLength, args…], so args are packed tightly.
library FamilyArgs {
    using Calldata for bytes;

    error TimeCapsuleArgsInvalid();
    error LowRiskGuardArgsInvalid();

    /// @dev _timeCapsule args: unlockAt (8B) ++ beneficiary (20B)
    function parseTimeCapsule(bytes calldata args) internal pure returns (uint64 unlockAt, address beneficiary) {
        unlockAt = uint64(bytes8(args.slice(0, 8, TimeCapsuleArgsInvalid.selector)));
        beneficiary = address(bytes20(args.slice(8, 28, TimeCapsuleArgsInvalid.selector)));
    }

    /// @dev _lowRiskGuard args: unlockAt (8B) ++ capBps (2B)
    function parseLowRiskGuard(bytes calldata args) internal pure returns (uint64 unlockAt, uint16 capBps) {
        unlockAt = uint64(bytes8(args.slice(0, 8, LowRiskGuardArgsInvalid.selector)));
        capBps = uint16(bytes2(args.slice(8, 10, LowRiskGuardArgsInvalid.selector)));
    }
}

/// @title FamilyVaultSwapVM
/// @notice The official AquaSwapVMRouter instruction set, extended with two
///         family-savings operators. The full 18-year policy of a vault is a
///         short program over this VM — data, not a contract redeploy:
///
///         opcode 33 _timeCapsule(unlockAt, beneficiary)
///             before unlockAt : anyone may swap (the vault is market-making)
///             after unlockAt  : only the beneficiary may swap (the opening trade)
///         opcode 34 _lowRiskGuard(unlockAt, capBps)
///             before unlockAt : a single fill may move at most capBps of the
///                               strategy's virtual balance — low-risk is
///                               enforced on-chain, not promised off-chain
///             after unlockAt  : retired, so the beneficiary can sweep
///
///         Official opcodes keep their indices (0–32), so standard programs
///         built for AquaSwapVMRouter run unchanged on this router.
contract FamilyVaultSwapVM is Simulator, SwapVM, AquaOpcodes {
    error CapsuleSealedForTaker(address taker, address beneficiary, uint64 unlockAt);
    error SwapExceedsLowRiskCap(uint256 amount, uint256 balance, uint16 capBps);

    constructor(
        address aqua,
        address weth,
        address owner
    ) SwapVM(aqua, weth, owner, "FamilyVault SwapVM", "1.0") AquaOpcodes(aqua) {}

    function _instructions()
        internal
        pure
        override
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        return _opcodes();
    }

    function _opcodes()
        internal
        pure
        virtual
        override
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        // the official AquaOpcodes table verbatim (indices 0–32), plus the
        // two family operators appended at 33/34 for backward compatibility
        function(Context memory, bytes calldata) internal[36] memory instructions = [
            _notInstruction,
            // 0–9 Debug — reserved
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            // 10–16 Controls
            _jump,
            _jumpIfTokenIn,
            _jumpIfTokenOut,
            _deadline,
            _onlyTakerTokenBalanceNonZero,
            _onlyTakerTokenBalanceGte,
            _onlyTakerTokenSupplyShareGte,
            // 17 XYCSwap
            _xycSwapXD,
            // 18 XYCConcentrate
            _xycConcentrateGrowLiquidity2D,
            // 19 Decay
            _decayXD,
            // 20–21
            _salt,
            _flatFeeAmountInXD,
            // 22–26 reserved
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            _notInstruction,
            // 27–32 Fees / PeggedSwap / Extruction
            _protocolFeeAmountInXD,
            _aquaProtocolFeeAmountInXD,
            _dynamicProtocolFeeAmountInXD,
            _aquaDynamicProtocolFeeAmountInXD,
            _peggedSwapGrowPriceRange2D,
            _extruction,
            // 33–34 Family operators
            _timeCapsule,
            _lowRiskGuard
        ];

        uint256 instructionsArrayLength = instructions.length - 1;
        assembly ("memory-safe") {
            result := instructions
            mstore(result, instructionsArrayLength)
        }
    }

    /// @notice opcode 33 — the capsule's era gate.
    /// @dev While the capsule accumulates, the strategy is open liquidity;
    ///      once it matures, every swap belongs to the beneficiary alone.
    function _timeCapsule(Context memory ctx, bytes calldata args) internal view {
        (uint64 unlockAt, address beneficiary) = FamilyArgs.parseTimeCapsule(args);
        if (block.timestamp < unlockAt) return;
        require(
            ctx.query.taker == beneficiary,
            CapsuleSealedForTaker(ctx.query.taker, beneficiary, unlockAt)
        );
    }

    /// @notice opcode 34 — on-chain "low-risk" enforcement.
    /// @dev Caps how much of the strategy's virtual balance a single fill may
    ///      move during the accumulation era. Checks the side the taker fixed;
    ///      the other side is bounded by the AMM curve.
    function _lowRiskGuard(Context memory ctx, bytes calldata args) internal view {
        (uint64 unlockAt, uint16 capBps) = FamilyArgs.parseLowRiskGuard(args);
        if (block.timestamp >= unlockAt) return;
        if (ctx.query.isExactIn) {
            require(
                ctx.swap.amountIn * 10_000 <= ctx.swap.balanceIn * capBps,
                SwapExceedsLowRiskCap(ctx.swap.amountIn, ctx.swap.balanceIn, capBps)
            );
        } else {
            require(
                ctx.swap.amountOut * 10_000 <= ctx.swap.balanceOut * capBps,
                SwapExceedsLowRiskCap(ctx.swap.amountOut, ctx.swap.balanceOut, capBps)
            );
        }
    }
}
