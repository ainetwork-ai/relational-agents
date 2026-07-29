/// A relationship as a first-class on-chain object.
///
/// The agent is born only when two people consent, is owned by neither of them
/// alone (it is a shared object whose rules are enforced by the chain), and
/// remembers only what those two shared. Memory bodies never touch this module:
/// the object stores Walrus blob ids for ciphertext, and `seal_approve` is the
/// on-chain predicate Seal key servers call before handing out a decryption key.
#[allow(lint(public_entry))]
module relational_agent::relational_agent;

use std::string::String;
use sui::clock::Clock;
use sui::event;
use sui::vec_set::{Self, VecSet};

const STATUS_ACTIVE: u8 = 0;
const STATUS_DISSOLVED: u8 = 1;

const EAlreadyDissolved: u64 = 1;
const ENotMember: u64 = 2;
const ENeedTwo: u64 = 3;
const EPolicyMismatch: u64 = 4;

/// The jointly-owned agent. Shared, so neither member holds it alone.
public struct RelationalAgent has key {
    id: UID,
    members: VecSet<address>,
    status: u8,
    memories: vector<MemoryRef>,
    created_at_ms: u64,
    /// 0 while active.
    dissolved_at_ms: u64,
}

/// A pointer to one sealed memory: the Walrus blob holding the ciphertext.
public struct MemoryRef has store, copy, drop {
    blob_id: String,
    kind: String,
    created_at_ms: u64,
}

public struct AgentCreated has copy, drop {
    agent: ID,
    member_a: address,
    member_b: address,
    created_at_ms: u64,
}

public struct MemoryAdded has copy, drop {
    agent: ID,
    blob_id: String,
    kind: String,
    author: address,
    created_at_ms: u64,
}

public struct AgentDissolved has copy, drop {
    agent: ID,
    by: address,
    dissolved_at_ms: u64,
}

/// Birth by mutual consent. Meant to be called inside a PTB that both members
/// sign, so the chain will not execute an agent neither of them agreed to.
public entry fun create(
    member_a: address,
    member_b: address,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(member_a != member_b, ENeedTwo);
    let mut members = vec_set::empty<address>();
    members.insert(member_a);
    members.insert(member_b);
    let now = clock.timestamp_ms();
    let agent = RelationalAgent {
        id: object::new(ctx),
        members,
        status: STATUS_ACTIVE,
        memories: vector[],
        created_at_ms: now,
        dissolved_at_ms: 0,
    };
    event::emit(AgentCreated {
        agent: object::id(&agent),
        member_a,
        member_b,
        created_at_ms: now,
    });
    transfer::share_object(agent);
}

/// Append a memory reference. Only a member of this relationship may write to
/// it, and only while it is active.
public entry fun add_memory(
    agent: &mut RelationalAgent,
    blob_id: String,
    kind: String,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(agent.status == STATUS_ACTIVE, EAlreadyDissolved);
    let sender = ctx.sender();
    assert!(agent.members.contains(&sender), ENotMember);
    let now = clock.timestamp_ms();
    agent
        .memories
        .push_back(MemoryRef { blob_id, kind, created_at_ms: now });
    event::emit(MemoryAdded {
        agent: object::id(agent),
        blob_id,
        kind,
        author: sender,
        created_at_ms: now,
    });
}

/// Dissolve. The object is not deleted: the record outlives the relationship.
public entry fun dissolve(agent: &mut RelationalAgent, clock: &Clock, ctx: &TxContext) {
    assert!(agent.status == STATUS_ACTIVE, EAlreadyDissolved);
    let sender = ctx.sender();
    assert!(agent.members.contains(&sender), ENotMember);
    let now = clock.timestamp_ms();
    agent.status = STATUS_DISSOLVED;
    agent.dissolved_at_ms = now;
    event::emit(AgentDissolved { agent: object::id(agent), by: sender, dissolved_at_ms: now });
}

/// The Seal policy. Key servers dry-run this before deriving the key for
/// identity `id`; an abort means "no key". Two conditions: the requester is a
/// member of this relationship, and the identity actually belongs to this
/// object, so a member of relationship X cannot unlock relationship Y's blob.
entry fun seal_approve(id: vector<u8>, agent: &RelationalAgent, ctx: &TxContext) {
    assert!(agent.members.contains(&ctx.sender()), ENotMember);
    assert!(is_prefix(object::id(agent).to_bytes(), id), EPolicyMismatch);
}

/// Seal identities are `[object id bytes][optional suffix]`.
fun is_prefix(prefix: vector<u8>, word: vector<u8>): bool {
    if (prefix.length() > word.length()) return false;
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != word[i]) return false;
        i = i + 1;
    };
    true
}

public fun is_member(agent: &RelationalAgent, who: address): bool {
    agent.members.contains(&who)
}

public fun status(agent: &RelationalAgent): u8 {
    agent.status
}

public fun members(agent: &RelationalAgent): vector<address> {
    *agent.members.keys()
}

public fun memory_count(agent: &RelationalAgent): u64 {
    agent.memories.length()
}

public fun created_at_ms(agent: &RelationalAgent): u64 {
    agent.created_at_ms
}

public fun dissolved_at_ms(agent: &RelationalAgent): u64 {
    agent.dissolved_at_ms
}

public fun memory_blob_id(agent: &RelationalAgent, i: u64): String {
    agent.memories[i].blob_id
}

public fun memory_kind(agent: &RelationalAgent, i: u64): String {
    agent.memories[i].kind
}
