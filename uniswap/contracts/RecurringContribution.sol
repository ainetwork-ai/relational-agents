// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The one Permit2 (AllowanceTransfer) function this contract calls.
interface IAllowanceTransfer {
    function transferFrom(address from, address to, uint160 amount, address token) external;
}

/**
 * @title RecurringContribution
 * @notice A member's standing contribution to a relation's pot: a fixed amount every period, pulled
 * through Uniswap's Permit2. One deployment serves every relation and every member; each plan carries
 * its own amount and its own period.
 *
 * The member starts a plan — the pot it pays into, the token, the amount per period, the period in
 * seconds, and when it ends — and gives this contract a Permit2 allowance on that token. Anyone may
 * then call pull(); the relation's agent does, once a period. A pull moves exactly amountPerPeriod
 * from the member to the plan's pot, at most once per period, until the plan ends or the member stops
 * it. The member can also cut it off in Permit2 alone (an allowance of 0), without this contract.
 *
 * Periods count from the plan's own start: period i is [startedAt + i·period, startedAt + (i+1)·period).
 * Missed periods do not accumulate: a late pull covers only the period it lands in, so no pull ever
 * moves more than one amountPerPeriod — an unused period is forfeited, as MetaMask's
 * ERC20PeriodTransferEnforcer forfeits one.
 *
 * A member's Permit2 allowance to this contract is per token, so it is shared by all of that member's
 * plans on the same token.
 */
contract RecurringContribution {
    IAllowanceTransfer public constant PERMIT2 = IAllowanceTransfer(0x000000000022D473030F116dDEE9F6B43aC78BA3);

    struct Plan {
        address member;
        address pot;
        address token;
        uint160 amountPerPeriod;
        uint48 period; // seconds
        uint48 startedAt;
        uint48 until; // pulls are refused from this timestamp on
        uint48 nextIndex; // the earliest period a pull may still take
        bool stopped;
    }

    mapping(bytes32 id => Plan) public plans;

    event Started(
        bytes32 indexed id,
        address indexed member,
        address indexed pot,
        address token,
        uint160 amountPerPeriod,
        uint48 period,
        uint48 until
    );
    event Pulled(bytes32 indexed id, uint48 index, uint160 amount);
    event Stopped(bytes32 indexed id);

    error BadPlan();
    error PlanExists();
    error NoPlan();
    error NotMember();
    error PlanStopped();
    error PlanEnded();
    error AlreadyPulledThisPeriod(uint48 index);

    function planId(address member, address pot, address token, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(member, pot, token, salt));
    }

    /// @notice Start a plan that pulls from msg.sender — nobody can start one that pulls from someone
    /// else, and the pot is fixed for the plan's life.
    function start(address pot, address token, uint160 amountPerPeriod, uint48 period, uint48 until, bytes32 salt)
        external
        returns (bytes32 id)
    {
        if (pot == address(0) || token == address(0) || amountPerPeriod == 0 || period == 0 || until <= block.timestamp) {
            revert BadPlan();
        }
        id = planId(msg.sender, pot, token, salt);
        if (plans[id].member != address(0)) revert PlanExists();
        plans[id] = Plan({
            member: msg.sender,
            pot: pot,
            token: token,
            amountPerPeriod: amountPerPeriod,
            period: period,
            startedAt: uint48(block.timestamp),
            until: until,
            nextIndex: 0,
            stopped: false
        });
        emit Started(id, msg.sender, pot, token, amountPerPeriod, period, until);
    }

    /// @notice Move this period's amount from the member to the plan's pot. Anyone may call it.
    function pull(bytes32 id) external {
        Plan storage p = plans[id];
        if (p.member == address(0)) revert NoPlan();
        if (p.stopped) revert PlanStopped();
        if (block.timestamp >= p.until) revert PlanEnded();
        uint48 index = uint48((block.timestamp - p.startedAt) / p.period);
        if (index < p.nextIndex) revert AlreadyPulledThisPeriod(index);
        // recorded before the external call, so the period is spent whatever the call does
        p.nextIndex = index + 1;
        PERMIT2.transferFrom(p.member, p.pot, p.amountPerPeriod, p.token);
        emit Pulled(id, index, p.amountPerPeriod);
    }

    /// @notice The member ends the plan; every pull is refused from then on.
    function stop(bytes32 id) external {
        Plan storage p = plans[id];
        if (p.member == address(0)) revert NoPlan();
        if (msg.sender != p.member) revert NotMember();
        p.stopped = true;
        emit Stopped(id);
    }
}
