// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * RelationalAgentRegistry — an ERC-8004 (Trustless Agents) compatible identity
 * registry where an agent can only be born from a RELATIONSHIP: its members —
 * a couple or a group — co-sign an EIP-712 consent, and that set of signatures
 * is what mints the agent. "An agent is born only when everyone in the
 * relationship agrees", enforced on-chain.
 *
 * ERC-8004 compatibility surface implemented here:
 *   - ERC-721 identity (agentId = tokenId, tokenURI = agent registration file)
 *   - register(...) overloads + Registered event
 *   - per-agent key/value metadata + MetadataSet event
 *   - getAgentWallet / URIUpdated / setAgentURI
 * plus the relational extension:
 *   - registerRelationalAgent(relationId, parties[], agentURI, sigs[])
 *
 * Deliberately dependency-free and minimal (hackathon-sized): the ERC-721
 * subset is enough for wallets/indexers to browse agents; approvals and
 * safeTransfer hooks are out of scope.
 */
contract RelationalAgentRegistry {
    // ── ERC-721 minimal identity ────────────────────────────────────────────
    string public constant name = "Relational Agents";
    string public constant symbol = "RELAGENT";

    uint256 private _nextId = 1;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => string) private _agentURI;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    function ownerOf(uint256 agentId) public view returns (address) {
        address o = _ownerOf[agentId];
        require(o != address(0), "no agent");
        return o;
    }

    function tokenURI(uint256 agentId) external view returns (string memory) {
        require(_ownerOf[agentId] != address(0), "no agent");
        return _agentURI[agentId];
    }

    // ── ERC-8004 identity registry ──────────────────────────────────────────
    struct MetadataEntry {
        string metadataKey;
        bytes metadataValue;
    }

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);
    event MetadataSet(
        uint256 indexed agentId,
        string indexed indexedMetadataKey,
        string metadataKey,
        bytes metadataValue
    );

    mapping(uint256 => mapping(string => bytes)) private _metadata;
    mapping(uint256 => address) private _agentWallet;

    function register(string memory agentURI_, MetadataEntry[] memory metadata)
        public
        returns (uint256 agentId)
    {
        agentId = _mint(msg.sender, agentURI_);
        for (uint256 i = 0; i < metadata.length; i++) {
            _setMetadata(agentId, metadata[i].metadataKey, metadata[i].metadataValue);
        }
    }

    function register(string memory agentURI_) external returns (uint256 agentId) {
        return register(agentURI_, new MetadataEntry[](0));
    }

    function register() external returns (uint256 agentId) {
        return register("", new MetadataEntry[](0));
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(msg.sender == ownerOf(agentId), "not owner");
        _agentURI[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return _agentWallet[agentId];
    }

    function getMetadata(uint256 agentId, string memory metadataKey)
        external
        view
        returns (bytes memory)
    {
        return _metadata[agentId][metadataKey];
    }

    function setMetadata(uint256 agentId, string memory metadataKey, bytes memory metadataValue)
        external
    {
        require(msg.sender == ownerOf(agentId), "not owner");
        _setMetadata(agentId, metadataKey, metadataValue);
    }

    // ── The relational extension: N signatures, one agent ─────────────────
    /// relationId (e.g. keccak256 of the room id) → the born agent (0 = none)
    mapping(bytes32 => uint256) public agentOfRelation;
    mapping(bytes32 => address[]) private _partiesOfRelation;

    event RelationalAgentRegistered(
        uint256 indexed agentId,
        bytes32 indexed relationId,
        address[] parties
    );

    bytes32 private constant CONSENT_TYPEHASH =
        keccak256("RelationConsent(bytes32 relationId,address[] parties)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    constructor() {
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("RelationalAgentRegistry")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function partiesOfRelation(bytes32 relationId) external view returns (address[] memory) {
        return _partiesOfRelation[relationId];
    }

    function consentDigest(bytes32 relationId, address[] memory parties)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                DOMAIN_SEPARATOR,
                keccak256(
                    abi.encode(
                        CONSENT_TYPEHASH,
                        relationId,
                        keccak256(abi.encodePacked(parties))
                    )
                )
            )
        );
    }

    /**
     * Every party signed the same RelationConsent — mint their agent. Works
     * for couples and for groups alike: `parties` must be sorted ascending
     * (the canonical order both the app and wallets present) and `sigs[i]`
     * must recover `parties[i]`. Anyone may relay, so no member pays gas.
     * The agent NFT is held by the registry itself: a relational agent is
     * jointly owned by the relationship, not by any one member.
     */
    function registerRelationalAgent(
        bytes32 relationId,
        address[] calldata parties,
        string calldata agentURI_,
        bytes[] calldata sigs
    ) external returns (uint256 agentId) {
        require(parties.length >= 2, "need at least two parties");
        require(sigs.length == parties.length, "one signature per party");
        require(agentOfRelation[relationId] == 0, "relation already has an agent");

        bytes32 digest = consentDigest(relationId, parties);
        for (uint256 i = 0; i < parties.length; i++) {
            require(parties[i] != address(0), "bad party");
            if (i > 0) require(parties[i] > parties[i - 1], "parties must be sorted+unique");
            require(_recover(digest, sigs[i]) == parties[i], "signature invalid");
        }

        agentId = _mint(address(this), agentURI_);
        agentOfRelation[relationId] = agentId;
        _partiesOfRelation[relationId] = parties;
        _setMetadata(agentId, "relationId", abi.encodePacked(relationId));
        _setMetadata(agentId, "parties", abi.encodePacked(parties));
        emit RelationalAgentRegistered(agentId, relationId, parties);
    }

    // ── internals ───────────────────────────────────────────────────────────
    function _mint(address to, string memory uri) private returns (uint256 agentId) {
        agentId = _nextId++;
        _ownerOf[agentId] = to;
        balanceOf[to] += 1;
        _agentURI[agentId] = uri;
        emit Transfer(address(0), to, agentId);
        emit Registered(agentId, uri, to);
    }

    function _setMetadata(uint256 agentId, string memory key, bytes memory value) private {
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, key, value);
    }

    function _recover(bytes32 digest, bytes calldata sig) private pure returns (address) {
        require(sig.length == 65, "bad signature length");
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "bad v");
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "bad signature");
        return signer;
    }
}
