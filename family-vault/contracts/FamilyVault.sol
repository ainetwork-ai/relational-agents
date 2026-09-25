// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/libs/MakerTraits.sol";
import { SafeERC20, IERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";

/// @title FamilyVault
/// @notice A time-capsule savings vault on 1inch Aqua. Parents deposit tokens
///         for a child; the vault itself becomes the Aqua maker, so the funds
///         never sit in anyone else's pool for the 18-year ride. The operating
///         policy is a short SwapVM program (see FamilyVaultSwapVM) that the
///         parent can re-ship at any time — the principal cannot be touched.
///
///         Rules:
///         - deposit      anyone, any time (grandparents welcome)
///         - shipPolicy   parent — dock the old program, ship a new one
///         - claim        beneficiary, after unlockAt
///         - emergency    parent may request an early exit; it executes only
///                        after EXIT_DELAY and only before maturity, and the
///                        request itself is a public on-chain event
contract FamilyVault {
    using SafeERC20 for IERC20;

    error OnlyParent();
    error OnlyBeneficiary();
    error CapsuleNotMatured(uint64 unlockAt);
    error CapsuleAlreadyClosed();
    error NoExitRequested();
    error ExitDelayNotPassed(uint64 executableAt);
    error ExitAfterMaturity();

    event Deposited(address indexed from, address indexed token, uint256 amount, string memo);
    event PolicyShipped(bytes32 indexed strategyHash, address token0, address token1, uint256 amount0, uint256 amount1, uint16 capBps);
    event PolicyDocked(bytes32 indexed strategyHash);
    event CapsuleOpened(address indexed beneficiary, address[] tokens, uint256[] amounts);
    event ExitRequested(uint64 executableAt);
    event ExitCancelled();
    event ExitExecuted(address indexed parent, address[] tokens, uint256[] amounts);

    uint64 public constant EXIT_DELAY = 30 days;

    IAqua public immutable AQUA;
    address public immutable ROUTER;
    address public immutable PARENT;
    address public immutable BENEFICIARY;
    uint64 public immutable UNLOCK_AT;

    bytes32 public strategyHash;
    /// @dev abi.encode(ISwapVM.Order) of the live policy — takers fetch this
    ///      to swap against the vault through the router
    bytes public currentOrder;
    address[] public managedTokens;
    uint64 public exitRequestedAt;
    uint64 public policyNonce;
    bool public closed;

    modifier onlyParent() {
        require(msg.sender == PARENT, OnlyParent());
        _;
    }

    constructor(address aqua, address router, address parent, address beneficiary, uint64 unlockAt) {
        AQUA = IAqua(aqua);
        ROUTER = router;
        PARENT = parent;
        BENEFICIARY = beneficiary;
        UNLOCK_AT = unlockAt;
    }

    /// @notice Put tokens into the capsule, with a memo the workspace keeps.
    function deposit(address token, uint256 amount, string calldata memo) external {
        require(!closed, CapsuleAlreadyClosed());
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, token, amount, memo);
    }

    /// @notice Ship (or replace) the operating policy. The policy is bytecode:
    ///         salt ++ timeCapsule(unlockAt, beneficiary) ++ lowRiskGuard(unlockAt, capBps) ++ xycSwap.
    function shipPolicy(address token0, address token1, uint256 amount0, uint256 amount1, uint16 capBps)
        external
        onlyParent
        returns (bytes32)
    {
        require(!closed, CapsuleAlreadyClosed());
        _dockIfShipped();

        bytes memory program = abi.encodePacked(
            uint8(20), uint8(8), uint64(++policyNonce),      // _salt: every policy is a distinct strategy
            uint8(33), uint8(28), UNLOCK_AT, BENEFICIARY,    // _timeCapsule
            uint8(34), uint8(10), UNLOCK_AT, capBps,         // _lowRiskGuard
            uint8(17), uint8(0)                              // _xycSwapXD
        );

        MakerTraitsLib.Args memory args;
        args.maker = address(this);
        args.useAquaInsteadOfSignature = true;
        args.program = program;
        ISwapVM.Order memory order = MakerTraitsLib.build(args);
        currentOrder = abi.encode(order);

        IERC20(token0).forceApprove(address(AQUA), type(uint256).max);
        IERC20(token1).forceApprove(address(AQUA), type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = token0;
        tokens[1] = token1;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount0;
        amounts[1] = amount1;

        managedTokens = tokens;
        strategyHash = AQUA.ship(ROUTER, currentOrder, tokens, amounts);
        emit PolicyShipped(strategyHash, token0, token1, amount0, amount1, capBps);
        return strategyHash;
    }

    /// @notice After maturity the beneficiary opens the capsule: the policy is
    ///         docked and every managed token goes to them.
    function claim() external {
        require(msg.sender == BENEFICIARY, OnlyBeneficiary());
        require(block.timestamp >= UNLOCK_AT, CapsuleNotMatured(UNLOCK_AT));
        require(!closed, CapsuleAlreadyClosed());
        _dockIfShipped();
        closed = true;
        (address[] memory tokens, uint256[] memory amounts) = _sweep(BENEFICIARY);
        emit CapsuleOpened(BENEFICIARY, tokens, amounts);
    }

    /// @notice Life happens. The parent may ask out early — in public, and the
    ///         capsule waits EXIT_DELAY before it obeys.
    function requestExit() external onlyParent {
        require(!closed, CapsuleAlreadyClosed());
        exitRequestedAt = uint64(block.timestamp);
        emit ExitRequested(uint64(block.timestamp) + EXIT_DELAY);
    }

    function cancelExit() external onlyParent {
        require(exitRequestedAt != 0, NoExitRequested());
        exitRequestedAt = 0;
        emit ExitCancelled();
    }

    function executeExit() external onlyParent {
        require(!closed, CapsuleAlreadyClosed());
        require(exitRequestedAt != 0, NoExitRequested());
        uint64 executableAt = exitRequestedAt + EXIT_DELAY;
        require(block.timestamp >= executableAt, ExitDelayNotPassed(executableAt));
        // once the capsule has matured it belongs to the child, not the exit
        require(block.timestamp < UNLOCK_AT, ExitAfterMaturity());
        _dockIfShipped();
        closed = true;
        (address[] memory tokens, uint256[] memory amounts) = _sweep(PARENT);
        emit ExitExecuted(PARENT, tokens, amounts);
    }

    function _dockIfShipped() private {
        if (strategyHash == bytes32(0)) return;
        AQUA.dock(ROUTER, strategyHash, managedTokens);
        emit PolicyDocked(strategyHash);
        strategyHash = bytes32(0);
    }

    function _sweep(address to) private returns (address[] memory tokens, uint256[] memory amounts) {
        tokens = managedTokens;
        amounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; i++) {
            amounts[i] = IERC20(tokens[i]).balanceOf(address(this));
            if (amounts[i] > 0) IERC20(tokens[i]).safeTransfer(to, amounts[i]);
        }
    }
}
