// GENERATED from ens/src/abi.ts by ens/scripts/sync-to-app.mjs — edit it there, then re-run the script.
// ens/src/abi.ts
// The slices of ENSv2 (contracts-v2@71a3b73) this feature calls.
import { parseAbi } from "viem";

export const registryAbi = parseAbi([
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "event LabelRegistered(uint256 indexed tokenId, bytes32 indexed labelHash, string label, address owner, uint64 expiry, address indexed sender)",
  // IStandardRegistry at 71a3b73 (after the event: chain.ts reads registryAbi[3]): anyId = uint256(labelhash(label)); needs ROLE_SET_SUBREGISTRY (root roles count)
  "function setSubregistry(uint256 anyId, address registry)",
]);

export const userRegistryInitAbi = parseAbi(["function initialize((address account, uint256 roleBitmap)[] grants)"]);

export const resolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function setAddress(bytes name, uint256 coinType, bytes addressBytes)",
]);

export const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)",
]);

export const universalHelperAbi = parseAbi([
  "function findExactRegistry(bytes name) view returns (address)",
  "function findRegistries(bytes name) view returns (address[])",
  "function findExactOwner(bytes name) view returns (address)",
]);

export const ethRegistrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function MAX_COMMITMENT_AGE() view returns (uint64)",
  // the public mapping is `commitmentAt` at 71a3b73 (not `commitments`): commit time, 0 when absent or consumed
  "function commitmentAt(bytes32 commitment) view returns (uint64)",
  // renewal (IETHRenewer): anyone may renew, paying from msg.sender; no commit–reveal
  "function renew((string label, uint64 duration, bytes32 referrer) rd, address paymentToken)",
  "function getRenewPrice(string label, uint64 duration, address paymentToken) view returns (uint256)",
  "function isRenewable(string label) view returns (bool)",
  "function getRemainingGracePeriod(string label) view returns (uint64)",
  "function GRACE_PERIOD() view returns (uint64)",
  "event NameRenewed(uint256 indexed tokenId, string label, uint64 duration, uint64 newExpiry, address paymentToken, bytes32 indexed referrer, uint256 amount)",
]);

/** PermissionedRegistry (the .eth registry included): `getState(anyId)` with anyId = uint256(keccak256(label)).
 *  status: 0 AVAILABLE · 1 RESERVED · 2 REGISTERED. latestOwner survives expiry (it is the last holder). */
export const permissionedRegistryAbi = parseAbi([
  "struct State { uint8 status; uint64 expiry; address latestOwner; uint256 tokenId; uint256 resource; }",
  "function getState(uint256 anyId) view returns (State state)",
]);

/** EnhancedAccessControl: true when `account` holds every role of `roleBitmap` in ROOT_RESOURCE. */
export const accessControlAbi = parseAbi(["function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)"]);

export const mockUsdcAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
