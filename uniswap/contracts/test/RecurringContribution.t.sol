// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RecurringContribution} from "../RecurringContribution.sol";

/// @dev The Foundry cheatcodes these tests use (no forge-std in this package).
interface Vm {
    function addr(uint256 privateKey) external pure returns (address);
    function deal(address account, uint256 newBalance) external;
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
    function startPrank(address sender) external;
    function stopPrank() external;
    function expectRevert(bytes calldata revertData) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev The Permit2 calls a member makes, and its errors.
interface IPermit2 {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;

    error AllowanceExpired(uint256 deadline);
    error InsufficientAllowance(uint256 amount);
}

/**
 * Run on a fork of Base mainnet — the real Permit2 and the real USDC — through
 * `node --test` (test/recurring-contribution.test.js runs `forge test --fork-url`). Each test starts
 * from the fork as it was; time moves only inside a test.
 */
contract RecurringContributionTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    IPermit2 constant PERMIT2 = IPermit2(0x000000000022D473030F116dDEE9F6B43aC78BA3);
    /// the Base USDC/WETH 0.05% pool — a USDC holder to fund members from, on the fork only
    address constant USDC_HOLDER = 0xd0b53D9277642d899DF5C87A3966A349A798F224;

    uint160 constant WEEKLY = 100_000; // 0.1 USDC
    uint48 constant WEEK = 7 days;

    RecurringContribution rc;
    address member;
    address pot;
    address stranger;
    bytes32 id;
    uint48 startedAt;
    uint48 until;

    function setUp() public {
        rc = new RecurringContribution();
        member = actor(0xA11CE);
        pot = vm.addr(0xB0B);
        stranger = actor(0x5CAFE);
        startedAt = uint48(block.timestamp);
        until = startedAt + 10 * WEEK;
        fund(member, 10_000_000); // 10 USDC
        vm.startPrank(member);
        // both approvals are the plan's total, never unlimited: a broken contract could move no more than this
        IERC20(USDC).approve(address(PERMIT2), 4 * WEEKLY);
        PERMIT2.approve(USDC, address(rc), 4 * WEEKLY, until); // four weeks' worth, until the plan ends
        id = rc.start(pot, USDC, WEEKLY, WEEK, until, bytes32("tokyo-trip"));
        vm.stopPrank();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// An address the tests act as. On a Base fork a pranked sender needs some ETH, or its call reverts
    /// before it runs (measured with forge 1.8.3); this is the fork's ETH, not real.
    function actor(uint256 privateKey) internal returns (address a) {
        a = vm.addr(privateKey);
        vm.deal(a, 1 ether);
    }

    function fund(address to, uint256 amount) internal {
        vm.deal(USDC_HOLDER, 1 ether);
        vm.prank(USDC_HOLDER);
        IERC20(USDC).transfer(to, amount);
    }

    function balance(address who) internal view returns (uint256) {
        return IERC20(USDC).balanceOf(who);
    }

    function pullAs(address caller, bytes32 plan) internal {
        vm.prank(caller);
        rc.pull(plan);
    }

    /// bit i set = period i was pulled
    function pulledOf(bytes32 plan) internal view returns (uint256 pulled) {
        (,,,,,,,, pulled) = rc.plans(plan);
    }

    function stoppedAtOf(bytes32 plan) internal view returns (uint48 stoppedAt) {
        (,,,,,,, stoppedAt,) = rc.plans(plan);
    }

    function potOf(bytes32 plan) internal view returns (address p) {
        (, p,,,,,,,) = rc.plans(plan);
    }

    // ── the guarantees ────────────────────────────────────────────────────────

    function test_a_pull_moves_exactly_the_amount_from_the_member_to_the_pot() public {
        uint256 m0 = balance(member);
        uint256 p0 = balance(pot);
        pullAs(stranger, id); // anyone may call pull
        require(m0 - balance(member) == WEEKLY, "member paid exactly one amount");
        require(balance(pot) - p0 == WEEKLY, "the pot got exactly one amount");
        require(pulledOf(id) == 1, "period 0 is spent");
    }

    function test_a_second_pull_in_the_same_period_reverts() public {
        pullAs(stranger, id);
        vm.warp(startedAt + WEEK - 1); // the last second of period 0
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.AlreadyPulledThisPeriod.selector, uint48(0)));
        rc.pull(id);
    }

    function test_the_next_period_pull_works() public {
        uint256 p0 = balance(pot);
        pullAs(stranger, id);
        vm.warp(startedAt + WEEK); // period 1 begins
        pullAs(stranger, id);
        require(balance(pot) - p0 == 2 * WEEKLY, "two periods, two amounts");
        require(pulledOf(id) == 0x3, "periods 0 and 1 are spent");
    }

    function test_a_pull_at_or_after_until_reverts() public {
        vm.warp(until - 1);
        pullAs(stranger, id); // the plan's last second still counts
        vm.warp(until);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.PlanEnded.selector));
        rc.pull(id);
        vm.warp(until + 30 days);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.PlanEnded.selector));
        rc.pull(id);
    }

    function test_after_stop_every_pull_reverts() public {
        vm.warp(startedAt + 2 days);
        vm.prank(member);
        rc.stop(id);
        require(stoppedAtOf(id) == startedAt + 2 days, "the stop is dated");
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.PlanStopped.selector));
        rc.stop(id); // a plan stops once
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.PlanStopped.selector));
        rc.pull(id);
        vm.warp(startedAt + 3 * WEEK);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.PlanStopped.selector));
        rc.pull(id);
    }

    function test_after_the_member_revokes_in_permit2_pulls_revert() public {
        pullAs(stranger, id);
        // straight in Permit2 — this contract is not asked; an expiration of 0 is stored as "now"
        uint256 revokedAt = block.timestamp;
        vm.prank(member);
        PERMIT2.approve(USDC, address(rc), 0, 0);
        vm.warp(startedAt + WEEK);
        vm.expectRevert(abi.encodeWithSelector(IPermit2.AllowanceExpired.selector, revokedAt));
        rc.pull(id);
    }

    function test_the_pot_cannot_change_after_start() public {
        address otherPot = vm.addr(0xE11E);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.PlanExists.selector));
        rc.start(pot, USDC, WEEKLY, WEEK, until, bytes32("tokyo-trip"));
        // another pot is another plan, with its own id; this plan still pays the pot it started with
        vm.prank(member);
        bytes32 other = rc.start(otherPot, USDC, WEEKLY, WEEK, until, bytes32("tokyo-trip"));
        require(other != id, "a different pot is a different plan");
        require(potOf(id) == pot, "the plan's pot is unchanged");
        uint256 p0 = balance(pot);
        pullAs(stranger, id);
        require(balance(pot) - p0 == WEEKLY, "the pull paid the original pot");
        require(balance(otherPot) == 0, "and nothing went to the other pot");
    }

    function test_only_the_member_can_stop() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.NotMember.selector));
        rc.stop(id);
        pullAs(stranger, id); // still running
    }

    function test_when_the_permit2_allowance_is_used_up_pulls_revert() public {
        for (uint48 i = 0; i < 4; i++) {
            vm.warp(startedAt + i * WEEK);
            pullAs(stranger, id);
        }
        vm.warp(startedAt + 4 * WEEK);
        vm.expectRevert(abi.encodeWithSelector(IPermit2.InsufficientAllowance.selector, uint256(0)));
        rc.pull(id);
    }

    function test_nobody_can_start_a_plan_that_pulls_from_someone_else() public {
        // a plan started by the stranger pulls from the stranger, who never allowed this contract anything
        vm.prank(stranger);
        bytes32 theirs = rc.start(stranger, USDC, WEEKLY, WEEK, until, bytes32("tokyo-trip"));
        (address planMember,,,,,,,,) = rc.plans(theirs);
        require(planMember == stranger, "the member is whoever started it");
        vm.expectRevert(abi.encodeWithSelector(IPermit2.AllowanceExpired.selector, uint256(0)));
        rc.pull(theirs);
        require(balance(member) == 10_000_000, "the member's USDC is untouched");
    }

    function test_start_refuses_a_plan_that_could_never_run() public {
        vm.startPrank(member);
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.BadPlan.selector));
        rc.start(pot, USDC, WEEKLY, 0, until, bytes32("zero period"));
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.BadPlan.selector));
        rc.start(pot, USDC, 0, WEEK, until, bytes32("zero amount"));
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.BadPlan.selector));
        rc.start(pot, USDC, WEEKLY, WEEK, startedAt, bytes32("already over"));
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.BadPlan.selector));
        rc.start(address(0), USDC, WEEKLY, WEEK, until, bytes32("no pot"));
        vm.stopPrank();
    }

    // ── per-plan amount and period ────────────────────────────────────────────

    function test_two_plans_with_different_pots_and_periods_run_on_their_own_schedules() public {
        // another member pays another relation's pot 0.25 USDC every 30 days
        address member2 = actor(0xC0FFEE);
        address pot2 = vm.addr(0xD00D);
        uint160 monthly = 250_000;
        uint48 month = 30 days;
        fund(member2, 10_000_000);
        vm.startPrank(member2);
        IERC20(USDC).approve(address(PERMIT2), 3 * monthly);
        PERMIT2.approve(USDC, address(rc), 3 * monthly, startedAt + 3 * month);
        bytes32 monthlyPlan = rc.start(pot2, USDC, monthly, month, startedAt + 3 * month, bytes32("family"));
        vm.stopPrank();

        pullAs(stranger, id); // weekly: period 0
        pullAs(stranger, monthlyPlan); // monthly: period 0

        vm.warp(startedAt + WEEK); // a week in
        pullAs(stranger, id); // weekly: period 1 — due
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.AlreadyPulledThisPeriod.selector, uint48(0)));
        rc.pull(monthlyPlan); // monthly: still period 0

        vm.warp(startedAt + month); // thirty days in: weekly period 4, monthly period 1
        pullAs(stranger, id);
        pullAs(stranger, monthlyPlan);

        require(balance(pot) == 3 * WEEKLY, "the weekly pot got three weekly amounts");
        require(balance(pot2) == 2 * monthly, "the monthly pot got two monthly amounts");
        require(pulledOf(id) == 0x13, "weekly plan: periods 0, 1 and 4 taken");
        require(pulledOf(monthlyPlan) == 0x3, "monthly plan: periods 0 and 1 taken");
    }

    function test_a_late_pull_after_missed_periods_moves_only_one_amount() public {
        vm.warp(startedAt + 5 * WEEK + 1 days); // periods 0-4 were never pulled
        uint256 m0 = balance(member);
        pullAs(stranger, id);
        require(m0 - balance(member) == WEEKLY, "one amount, not six");
        require(pulledOf(id) == 1 << 5, "period 5 is spent; 0-4 were never pulled");
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.AlreadyPulledThisPeriod.selector, uint48(5)));
        rc.pull(id);
        vm.warp(startedAt + 6 * WEEK);
        pullAs(stranger, id); // period 6 is due as usual
    }

    function test_a_members_plans_on_one_token_share_one_permit2_allowance() public {
        // the member's second plan on the same token draws on the same allowance to this contract
        address pot2 = vm.addr(0xD00D);
        vm.prank(member);
        bytes32 second = rc.start(pot2, USDC, 3 * WEEKLY, WEEK, until, bytes32("second"));
        pullAs(stranger, second); // 0.3 of the 0.4 the member allowed this contract
        pullAs(stranger, id); // the last 0.1
        vm.warp(startedAt + WEEK);
        vm.expectRevert(abi.encodeWithSelector(IPermit2.InsufficientAllowance.selector, uint256(0)));
        rc.pull(second);
        vm.expectRevert(abi.encodeWithSelector(IPermit2.InsufficientAllowance.selector, uint256(0)));
        rc.pull(id);
    }

    // ── what an app reads ─────────────────────────────────────────────────────

    function test_plansOf_lists_every_plan_that_pays_into_a_pot() public {
        address member2 = actor(0xC0FFEE);
        address otherPot = vm.addr(0xE11E);
        vm.prank(member2);
        bytes32 second = rc.start(pot, USDC, 2 * WEEKLY, 2 * WEEK, until, bytes32("fortnightly"));
        vm.prank(member);
        bytes32 elsewhere = rc.start(otherPot, USDC, WEEKLY, WEEK, until, bytes32("tokyo-trip"));
        pullAs(stranger, id);
        vm.prank(member2);
        rc.stop(second);

        (bytes32[] memory ids, RecurringContribution.Plan[] memory list) = rc.plansOf(pot);
        require(ids.length == 2 && list.length == 2, "two plans pay into the pot");
        require(ids[0] == id && ids[1] == second, "in start order");
        require(list[0].member == member && list[0].amountPerPeriod == WEEKLY && list[0].pulled == 1, "the first, pulled once");
        require(list[1].member == member2 && list[1].period == 2 * WEEK && list[1].stoppedAt == block.timestamp, "the second, stopped");
        (bytes32[] memory otherIds,) = rc.plansOf(otherPot);
        require(otherIds.length == 1 && otherIds[0] == elsewhere, "the other pot lists only its own");
        (bytes32[] memory none,) = rc.plansOf(stranger);
        require(none.length == 0, "a pot nobody pays into lists nothing");
    }

    function test_start_refuses_more_periods_than_pulled_can_hold() public {
        vm.startPrank(member);
        uint48 day = 1 days;
        vm.expectRevert(abi.encodeWithSelector(RecurringContribution.BadPlan.selector));
        rc.start(pot, USDC, WEEKLY, day, startedAt + 256 * day + 1, bytes32("257 days"));
        bytes32 longest = rc.start(pot, USDC, WEEKLY, day, startedAt + 256 * day, bytes32("256 days"));
        PERMIT2.approve(USDC, address(rc), WEEKLY, startedAt + 256 * day); // setUp's allowance ends at week 10
        vm.stopPrank();
        vm.warp(startedAt + 256 * day - 1); // the last second of period 255
        pullAs(stranger, longest);
        require(pulledOf(longest) == 1 << 255, "period 255 is the last bit");
    }
}
