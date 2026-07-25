#[test_only]
module relational_agent::relational_agent_tests;

use relational_agent::relational_agent::{Self, RelationalAgent};
use std::string;
use sui::clock;
use sui::test_scenario as ts;

const ALICE: address = @0xA;
const BOB: address = @0xB;
const AVA: address = @0xEEE;

#[test]
fun members_can_write_and_dissolve() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());

    relational_agent::create(ALICE, BOB, &clk, sc.ctx());

    sc.next_tx(ALICE);
    let mut agent = sc.take_shared<RelationalAgent>();
    assert!(agent.is_member(ALICE));
    assert!(agent.is_member(BOB));
    assert!(!agent.is_member(AVA));
    assert!(agent.status() == 0);
    agent.add_memory(
        string::utf8(b"walrus://demo-egg-tart-blob"),
        string::utf8(b"date"),
        &clk,
        sc.ctx(),
    );
    assert!(agent.memory_count() == 1);
    ts::return_shared(agent);

    sc.next_tx(BOB);
    let mut agent = sc.take_shared<RelationalAgent>();
    agent.dissolve(&clk, sc.ctx());
    assert!(agent.status() == 1);
    assert!(agent.dissolved_at_ms() == 0 || agent.dissolved_at_ms() >= agent.created_at_ms());
    ts::return_shared(agent);

    clk.destroy_for_testing();
    sc.end();
}

#[test]
#[expected_failure(abort_code = relational_agent::ENotMember)]
fun non_member_cannot_add_memory() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());

    relational_agent::create(ALICE, BOB, &clk, sc.ctx());

    sc.next_tx(AVA);
    let mut agent = sc.take_shared<RelationalAgent>();
    agent.add_memory(string::utf8(b"walrus://stolen"), string::utf8(b"date"), &clk, sc.ctx());

    ts::return_shared(agent);
    clk.destroy_for_testing();
    sc.end();
}

#[test]
#[expected_failure(abort_code = relational_agent::ENeedTwo)]
fun cannot_relate_to_self() {
    let mut sc = ts::begin(ALICE);
    let clk = clock::create_for_testing(sc.ctx());
    relational_agent::create(ALICE, ALICE, &clk, sc.ctx());
    clk.destroy_for_testing();
    sc.end();
}
