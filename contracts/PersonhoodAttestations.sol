// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PersonhoodAttestations — proof of personhood that can arrive late.
 *
 * RelationalAgentRegistry binds a World ID nullifier per party at the moment
 * the agent is minted, which is the strongest form: the agent is born already
 * knowing two humans stand behind it. But people meet before they verify. An
 * agent born without proofs was stuck that way forever, and a couple who
 * verified afterwards had no way to say so on chain.
 *
 * This contract is that second door. It never mints anything and it cannot
 * make an agent exist — it only records, for a relationId, one nullifier per
 * party, with the same Sybil rule the registry uses: no human may hold two
 * sides of the same relationship. A seller asks either source; both answer the
 * same question.
 *
 * The attestor is the relayer that already verifies proofs off-chain before
 * submitting them, so the trust here is exactly the trust in the registration
 * path — no more, and it is stated rather than implied.
 */
contract PersonhoodAttestations {
    address public immutable attestor;

    mapping(bytes32 => mapping(address => uint256)) public nullifierOf;
    mapping(bytes32 => uint256) public boundAt;
    mapping(bytes32 => address[]) private _parties;

    event PersonhoodBound(bytes32 indexed relationId, address indexed party, uint256 nullifier);
    event RelationHumanBacked(bytes32 indexed relationId, uint256 partyCount, uint256 boundAt);

    constructor() {
        attestor = msg.sender;
    }

    /// Record every party's personhood for a relationship that already exists.
    function bindPersonhood(
        bytes32 relationId,
        address[] calldata parties,
        uint256[] calldata nullifiers
    ) external {
        require(msg.sender == attestor, "not attestor");
        require(parties.length >= 2, "need at least two parties");
        require(parties.length == nullifiers.length, "one nullifier per party");
        require(boundAt[relationId] == 0, "already bound");

        delete _parties[relationId];
        for (uint256 i = 0; i < parties.length; i++) {
            require(parties[i] != address(0), "bad party");
            uint256 n = nullifiers[i];
            require(n != 0, "missing personhood");
 // Sybil guard, per relation: one human cannot be both sides
            for (uint256 j = 0; j < i; j++) {
                require(nullifiers[j] != n, "duplicate personhood");
            }
            nullifierOf[relationId][parties[i]] = n;
            _parties[relationId].push(parties[i]);
            emit PersonhoodBound(relationId, parties[i], n);
        }

        boundAt[relationId] = block.timestamp;
        emit RelationHumanBacked(relationId, parties.length, block.timestamp);
    }

    function isHumanBacked(bytes32 relationId) external view returns (bool) {
        return boundAt[relationId] != 0;
    }

    function partiesOf(bytes32 relationId) external view returns (address[] memory) {
        return _parties[relationId];
    }
}
