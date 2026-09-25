// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { IERC20 } from "@1inch/solidity-utils/contracts/libraries/SafeERC20.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/libs/TakerTraits.sol";

import { FamilyVault } from "../contracts/FamilyVault.sol";
import { FamilyVaultSwapVM } from "../contracts/FamilyVaultSwapVM.sol";

/// Full lifecycle on a Base mainnet fork against the OFFICIAL Aqua registry:
/// deposit → ship policy → market swaps (guarded) → 18-year warp →
/// beneficiary-only era → claim / emergency exit.
contract FamilyVaultTest is Test {
    address constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;

    FamilyVaultSwapVM router;
    FamilyVault vault;

    address parent = makeAddr("parent");
    address child = makeAddr("child");
    address market = makeAddr("market"); // an arbitrary market taker
    uint64 unlockAt;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC", string("https://mainnet.base.org")));
        unlockAt = uint64(block.timestamp + 18 * 365 days);

        router = new FamilyVaultSwapVM(AQUA, WETH, address(this));
        vault = new FamilyVault(AQUA, address(router), parent, child, unlockAt);

        deal(USDC, parent, 1_000e6);
        deal(WETH, parent, 0.4e18);

        vm.startPrank(parent);
        IERC20(USDC).approve(address(vault), type(uint256).max);
        IERC20(WETH).approve(address(vault), type(uint256).max);
        vault.deposit(USDC, 1_000e6, "For Yuna's 100th day. See you at 18.");
        vault.deposit(WETH, 0.4e18, "");
        vault.shipPolicy(USDC, WETH, 1_000e6, 0.4e18, 500); // 5% per-fill cap
        vm.stopPrank();
    }

    // ---- helpers -------------------------------------------------------------

    function _order() internal view returns (ISwapVM.Order memory) {
        return abi.decode(vault.currentOrder(), (ISwapVM.Order));
    }

    function _takerBytes(address taker) internal pure returns (bytes memory) {
        TakerTraitsLib.Args memory t;
        t.taker = taker;
        t.isExactIn = true;
        t.useTransferFromAndAquaPush = true;
        return TakerTraitsLib.build(t);
    }

    function _swap(address taker, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        vm.startPrank(taker);
        IERC20(tokenIn).approve(address(router), type(uint256).max);
        (, amountOut,) = router.swap(_order(), tokenIn, tokenOut, amountIn, _takerBytes(taker));
        vm.stopPrank();
    }

    // ---- accumulation era ----------------------------------------------------

    function test_marketCanSwapWithinCap() public {
        deal(USDC, market, 100e6);
        uint256 out = _swap(market, USDC, WETH, 40e6); // 4% < 5% cap
        assertGt(out, 0, "market taker got WETH");
        assertEq(IERC20(WETH).balanceOf(market), out);
        // the vault's own wallet holds the inflow — self-custodial the whole time
        assertEq(IERC20(USDC).balanceOf(address(vault)), 1_040e6);
    }

    function test_lowRiskGuardBlocksOversizedFill() public {
        deal(USDC, market, 100e6);
        ISwapVM.Order memory order = _order();
        bytes memory takerBytes = _takerBytes(market);
        vm.startPrank(market);
        IERC20(USDC).approve(address(router), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(FamilyVaultSwapVM.SwapExceedsLowRiskCap.selector, 60e6, 1_000e6, 500)
        );
        router.swap(order, USDC, WETH, 60e6, takerBytes); // 6% > 5% cap
        vm.stopPrank();
    }

    function test_claimBeforeMaturityReverts() public {
        vm.prank(child);
        vm.expectRevert(abi.encodeWithSelector(FamilyVault.CapsuleNotMatured.selector, unlockAt));
        vault.claim();
    }

    // ---- maturity ------------------------------------------------------------

    function test_afterMaturityOnlyBeneficiaryMaySwap() public {
        vm.warp(unlockAt);
        deal(USDC, market, 40e6);
        ISwapVM.Order memory order = _order();
        bytes memory takerBytes = _takerBytes(market);
        vm.startPrank(market);
        IERC20(USDC).approve(address(router), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(FamilyVaultSwapVM.CapsuleSealedForTaker.selector, market, child, unlockAt)
        );
        router.swap(order, USDC, WETH, 40e6, takerBytes);
        vm.stopPrank();

        // the child's opening trade passes, and the low-risk cap has retired
        deal(USDC, child, 200e6);
        uint256 out = _swap(child, USDC, WETH, 200e6); // 20% — way over the old cap
        assertGt(out, 0, "beneficiary swap succeeded uncapped");
    }

    function test_claimTransfersEverythingToChild() public {
        deal(USDC, market, 40e6);
        _swap(market, USDC, WETH, 40e6); // some market activity first

        vm.warp(unlockAt);
        uint256 vaultUsdc = IERC20(USDC).balanceOf(address(vault));
        uint256 vaultWeth = IERC20(WETH).balanceOf(address(vault));
        assertGt(vaultUsdc, 1_000e6, "spread income accrued in USDC");

        vm.prank(child);
        vault.claim();

        assertEq(IERC20(USDC).balanceOf(child), vaultUsdc);
        assertEq(IERC20(WETH).balanceOf(child), vaultWeth);
        assertEq(IERC20(USDC).balanceOf(address(vault)), 0);
        assertTrue(vault.closed());
    }

    // ---- policy management ---------------------------------------------------

    function test_parentCanReshipPolicy() public {
        bytes32 oldHash = vault.strategyHash();
        vm.prank(parent);
        bytes32 newHash = vault.shipPolicy(USDC, WETH, 1_000e6, 0.4e18, 300); // tighten to 3%
        assertTrue(newHash != oldHash, "new policy is a distinct strategy");

        deal(USDC, market, 100e6);
        ISwapVM.Order memory order = _order();
        bytes memory takerBytes = _takerBytes(market);
        vm.startPrank(market);
        IERC20(USDC).approve(address(router), type(uint256).max);
        vm.expectRevert(
            abi.encodeWithSelector(FamilyVaultSwapVM.SwapExceedsLowRiskCap.selector, 40e6, 1_000e6, 300)
        );
        router.swap(order, USDC, WETH, 40e6, takerBytes); // 4% > new 3% cap
        vm.stopPrank();
    }

    function test_onlyParentShipsPolicy() public {
        vm.prank(market);
        vm.expectRevert(FamilyVault.OnlyParent.selector);
        vault.shipPolicy(USDC, WETH, 1, 1, 500);
    }

    // ---- emergency exit --------------------------------------------------------

    function test_exitWaitsForDelayThenReturnsFundsToParent() public {
        vm.prank(parent);
        vault.requestExit();

        vm.prank(parent);
        vm.expectRevert(
            abi.encodeWithSelector(FamilyVault.ExitDelayNotPassed.selector, uint64(block.timestamp) + 30 days)
        );
        vault.executeExit();

        vm.warp(block.timestamp + 30 days);
        vm.prank(parent);
        vault.executeExit();

        assertEq(IERC20(USDC).balanceOf(parent), 1_000e6);
        assertEq(IERC20(WETH).balanceOf(parent), 0.4e18);
        assertTrue(vault.closed());
    }

    function test_exitCancellable() public {
        vm.startPrank(parent);
        vault.requestExit();
        vault.cancelExit();
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(FamilyVault.NoExitRequested.selector);
        vault.executeExit();
        vm.stopPrank();
    }

    function test_exitImpossibleAfterMaturity() public {
        vm.prank(parent);
        vault.requestExit();
        vm.warp(unlockAt);
        vm.prank(parent);
        vm.expectRevert(FamilyVault.ExitAfterMaturity.selector);
        vault.executeExit();
    }
}
