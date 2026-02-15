# Protocol Discovery Analysis: Try-and-Fail Strategy in Lodestar

This document proves from the codebase that Lodestar uses a **try-and-fail strategy** for protocol support discovery, rather than proactively checking via the identify protocol. It also analyzes how this affects repeated requests to peers that don't support optional protocols.

## Table of Contents

1. [Summary of Findings](#summary-of-findings)
2. [Proof: Identify Protocol Usage](#proof-identify-protocol-usage)
3. [Proof: Try-and-Fail Request Flow](#proof-try-and-fail-request-flow)
4. [Proof: Error Handling for UNSUPPORTED_PROTOCOL](#proof-error-handling-for-unsupported_protocol)
5. [Proof: No Protocol Tracking in PeerData](#proof-no-protocol-tracking-in-peerdata)
6. [Impact: Repeated Requests to Non-Supporting Peers](#impact-repeated-requests-to-non-supporting-peers)
7. [Recommendation](#recommendation)

---

## Summary of Findings

| Aspect | Current Behavior | Evidence |
|--------|------------------|----------|
| **Identify usage** | Called on every connection, but only `agentVersion` extracted | `peerManager.ts:748-755` |
| **`protocols` field** | Available in IdentifyResult but **ignored** | `@libp2p/interface` types |
| **Request strategy** | Try request first, handle error after | `network.ts:620-631` |
| **UNSUPPORTED_PROTOCOL handling** | Scoring based on method type | `score.ts:56-66` |
| **Optional protocol penalty** | **No penalty** (`null` returned) | `score.ts:64` |
| **Protocol tracking** | **None** - PeerData has no `protocols` field | `peersData.ts:22-35` |

**Critical Issue**: For optional protocols (like LightClient methods), when a peer returns `UNSUPPORTED_PROTOCOL`:
1. No score penalty is applied
2. No record is kept that this peer doesn't support the protocol
3. The peer can be selected again for the same request type
4. This wastes bandwidth on repeated failed requests

---

## Proof: Identify Protocol Usage

### File: `packages/beacon-node/src/network/peers/peerManager.ts`

**Lines 748-766** - Identify is called but only `agentVersion` is used:

```typescript
this.libp2p.services.identify
  .identify(evt.detail)
  .then((result) => {
    const agentVersion = result.agentVersion;  // ✅ Used
    // result.protocols is AVAILABLE but IGNORED   // ❌ Not used
    if (agentVersion) {
      peerData.agentVersion = agentVersion;
      peerData.agentClient = getKnownClientFromAgentVersion(agentVersion);
    }
  })
  .catch((err) => {
    // Error handling...
  });
```

### File: `node_modules/@libp2p/interface/dist/src/index.d.ts`

**IdentifyResult type** - Shows `protocols` IS available:

```typescript
export interface IdentifyResult {
    peerId: PeerId;
    listenAddrs: Multiaddr[];
    protocols: string[];      // ← AVAILABLE but Lodestar ignores this!
    protocolVersion?: string;
    agentVersion?: string;    // ← Only thing Lodestar uses
    // ...
}
```

---

## Proof: Try-and-Fail Request Flow

### File: `packages/beacon-node/src/network/network.ts`

**Lines 543-572** - LightClient requests are made without any protocol check:

```typescript
async sendLightClientBootstrap(peerId: PeerIdStr, request: Root): Promise<LightClientBootstrap> {
  // No check if peer supports this protocol!
  return collectExactOneTyped(
    this.sendReqRespRequest(peerId, ReqRespMethod.LightClientBootstrap, [Version.V1], request),
    responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap]
  );
}

async sendLightClientOptimisticUpdate(peerId: PeerIdStr): Promise<LightClientOptimisticUpdate> {
  // No check if peer supports this protocol!
  return collectExactOneTyped(
    this.sendReqRespRequest(peerId, ReqRespMethod.LightClientOptimisticUpdate, [Version.V1], null),
    responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate]
  );
}
```

**Lines 620-631** - The underlying request method has no protocol validation:

```typescript
private sendReqRespRequest<Req>(
  peerId: PeerIdStr,
  method: ReqRespMethod,
  versions: number[],
  request: Req
): AsyncIterable<ResponseIncoming> {
  const fork = this.config.getForkName(this.clock.currentSlot);
  const requestType = requestSszTypeByMethod(fork, this.config)[method];
  const requestData = requestType ? requestType.serialize(request as never) : new Uint8Array();

  // Just sends the request - no protocol support check!
  return this.core.sendReqRespRequest({peerId, method, versions, requestData});
}
```

---

## Proof: Error Handling for UNSUPPORTED_PROTOCOL

### File: `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

**Lines 318-323** - Error handler is called after request fails:

```typescript
protected onOutgoingRequestError(peerId: PeerId, method: ReqRespMethod, error: RequestError): void {
  const peerAction = onOutgoingReqRespError(error, method);
  if (peerAction !== null) {
    this.peerRpcScores.applyAction(peerId, peerAction, error.type.code);
  }
  // Note: No tracking of which protocols the peer doesn't support!
}
```

### File: `packages/beacon-node/src/network/reqresp/score.ts`

**Lines 10-11** - Error code definition:

```typescript
const libp2pErrorCodes = {
  ERR_UNSUPPORTED_PROTOCOL: "ERR_UNSUPPORTED_PROTOCOL",
};
```

**Lines 56-66** - UNSUPPORTED_PROTOCOL handling by method type:

```typescript
if (e.message.includes(libp2pErrorCodes.ERR_UNSUPPORTED_PROTOCOL)) {
  switch (method) {
    case ReqRespMethod.Ping:
      return PeerAction.Fatal;           // Ban immediately
    case ReqRespMethod.Metadata:
    case ReqRespMethod.Status:
      return PeerAction.LowToleranceError;  // -10 score
    default:
      return null;  // ← NO PENALTY for LightClient methods!
  }
}
```

**Key Finding**: For any method not explicitly listed (including all LightClient methods), `null` is returned, meaning **no scoring penalty** is applied.

---

## Proof: No Protocol Tracking in PeerData

### File: `packages/beacon-node/src/network/peers/peersData.ts`

**Lines 22-35** - PeerData structure has NO protocols field:

```typescript
export type PeerData = {
  lastReceivedMsgUnixTsMs: number;
  lastStatusUnixTsMs: number;
  connectedUnixTsMs: number;
  relevantStatus: RelevantPeerStatus;
  direction: "inbound" | "outbound";
  peerId: PeerId;
  nodeId: NodeId | null;
  metadata: Metadata | null;
  status: Status | null;
  agentVersion: string | null;        // ← From identify
  agentClient: ClientKind | null;     // ← Derived from agentVersion
  encodingPreference: Encoding | null;
  // NO protocols field!
  // NO supportsLightClient field!
};
```

---

## Impact: Repeated Requests to Non-Supporting Peers

### What Prevents Immediate Retry?

**For mandatory protocols (BeaconBlocksByRange, etc.):**

The sync module has built-in retry protection:

```
File: packages/beacon-node/src/sync/range/batch.ts

downloadingError(peer: PeerIdStr): void {
  this.failedDownloadAttempts.push(peer);  // ← Track failed peer
  if (this.failedDownloadAttempts.length > MAX_BATCH_DOWNLOAD_ATTEMPTS) {
    throw new BatchError(...);
  }
  this.state = {status: BatchStatus.AwaitingDownload, blocks: this.state.blocks};
}
```

```
File: packages/beacon-node/src/sync/range/utils/peerBalancer.ts

bestPeerToRetryBatch(batch: Batch): PeerSyncMeta | undefined {
  const failedPeers = new Set(batch.getFailedPeers());
  const sortedBestPeers = sortBy(
    eligiblePeers,
    ({syncInfo}) => (failedPeers.has(syncInfo.peerId) ? 1 : 0), // ← Prefer peers WITHOUT failed requests
    ({syncInfo}) => this.activeRequestsByPeer.get(syncInfo.peerId) ?? 0,
    ({columns}) => -1 * columns
  );
  // ...
}
```

So for mandatory protocols:
1. Failed peer is tracked per-batch in `failedDownloadAttempts`
2. `bestPeerToRetryBatch()` sorts to prefer peers NOT in `failedPeers`
3. Same peer won't be retried until all other peers have been tried
4. After `MAX_BATCH_DOWNLOAD_ATTEMPTS` (20) total failures, batch fails

**For optional protocols (LightClient methods): NO PROTECTION!**

The critical difference:
- Beacon node **serves** LightClient data, it doesn't **request** it
- Light client package currently only uses REST transport
- There is **no batch/retry infrastructure** for optional protocol requests
- The only "protection" is the score system, which returns `null` (no penalty)

### Flow Analysis for Optional Protocols

```
1. Caller needs LightClientBootstrap
   │
2. Picks peer A from connected peers (no protocol check possible)
   │
3. Sends request: sendLightClientBootstrap(peerA, root)
   │
4. libp2p multistream-select tries to negotiate protocol
   │
5. Peer A doesn't support it → ERR_UNSUPPORTED_PROTOCOL
   │
6. onOutgoingReqRespError called:
   │  - method = LightClientBootstrap
   │  - Falls through to default case
   │  - Returns null (NO PENALTY)
   │
7. peerRpcScores.applyAction NOT called (peerAction is null)
   │
8. No record kept that peer A doesn't support LightClient
   │
9. Exception thrown to caller
   │
10. Caller catches, needs to try another peer
    │
    │  ❌ NO built-in infrastructure to track failed peers
    │  ❌ NO way to know peer A doesn't support this protocol
    │  ❌ If caller retries, may pick peer A again
    │
11. WASTED ROUND TRIP (potentially repeatedly)
```

### Key Difference Summary

| Aspect | Mandatory Protocols (Blocks) | Optional Protocols (LightClient) |
|--------|------------------------------|----------------------------------|
| Retry infrastructure | Yes (`Batch` class tracks failures) | **None** |
| Failed peer tracking | Yes (`failedDownloadAttempts`) | **None** |
| Peer selection avoids failures | Yes (`bestPeerToRetryBatch`) | **None** |
| Score penalty | Yes (`LowToleranceError`) | **None** (`null`) |
| Protocol support tracking | No | **No** |

---

### Example: BeaconBlocksByRoot Repeated Failures

When a synced beacon node uses `BeaconBlocksByRoot` (via `unknownBlock.ts`) to fetch missing blocks, it encounters the same problem with peers that don't support the protocol (e.g., light clients).

**File**: `packages/beacon-node/src/sync/unknownBlock.ts`

**Lines 492-494** - Each fetch creates a fresh exclusion set:

```typescript
private async fetchBlockInput(cacheItem: BlockInputSyncCacheItem): Promise<PendingBlockInput> {
  const rootHex = getBlockInputSyncCacheItemRootHex(cacheItem);
  const excludedPeers = new Set<PeerIdStr>();  // ← Created fresh EVERY fetch!
```

**Lines 569-580** - Peers are excluded only for the current fetch:

```typescript
} else if (e instanceof RequestError) {
  switch (e.type.code) {
    case RequestErrorCode.REQUEST_RATE_LIMITED:
    case RequestErrorCode.REQUEST_TIMEOUT:
      // do not exclude peer for these errors
      break;
    default:
      excludedPeers.add(peerId);  // ← Only excluded for THIS fetch operation
      break;
  }
}
```

**The Problem Visualized**:

```
Time T1: Gossip delivers Block A with unknown parent
─────────────────────────────────────────────────────
  fetchBlockInput(blockA) {
    excludedPeers = new Set()           // Fresh set

    Try lightClientPeer1 → UNSUPPORTED_PROTOCOL
      excludedPeers.add(lightClientPeer1)

    Try lightClientPeer2 → UNSUPPORTED_PROTOCOL
      excludedPeers.add(lightClientPeer2)

    Try fullNodePeer1 → SUCCESS
  }
  // excludedPeers is garbage collected


Time T2: Gossip delivers Block B with unknown parent (5 seconds later)
─────────────────────────────────────────────────────
  fetchBlockInput(blockB) {
    excludedPeers = new Set()           // Fresh set - NO MEMORY of T1!

    Try lightClientPeer1 → UNSUPPORTED_PROTOCOL  // ← WASTED! Already knew this
      excludedPeers.add(lightClientPeer1)

    Try fullNodePeer2 → SUCCESS
  }


Time T3: Gossip delivers Block C with unknown parent (10 seconds later)
─────────────────────────────────────────────────────
  fetchBlockInput(blockC) {
    excludedPeers = new Set()           // Fresh set - STILL no memory!

    Try lightClientPeer2 → UNSUPPORTED_PROTOCOL  // ← WASTED! Already knew this
      excludedPeers.add(lightClientPeer2)

    Try lightClientPeer1 → UNSUPPORTED_PROTOCOL  // ← WASTED AGAIN!
      excludedPeers.add(lightClientPeer1)

    Try fullNodePeer1 → SUCCESS
  }
```

**Key Observations**:

1. **No persistent memory**: Each `fetchBlockInput()` call starts with an empty `excludedPeers` set
2. **Same failures repeated**: Light client peers fail with `UNSUPPORTED_PROTOCOL` on every fetch
3. **No score penalty**: `score.ts` returns `null` for `BeaconBlocksByRoot` + `UNSUPPORTED_PROTOCOL`
4. **Compounds over time**: As more light clients join the network, more round trips are wasted

**Network Cost**:

If 20% of connected peers are light clients, and the node does 100 unknown block fetches:
- ~20 wasted round trips per fetch (trying light clients first by chance)
- ~2000 total wasted round trips
- Each round trip = multistream-select negotiation + timeout/error handling

### Score System Reference

**File**: `packages/beacon-node/src/network/peers/score/store.ts`

```typescript
const peerActionScore: Record<PeerAction, number> = {
  [PeerAction.Fatal]: -(MAX_SCORE - MIN_SCORE),  // -200 (instant ban)
  [PeerAction.LowToleranceError]: -10,            // ~5 occurrences = ban
  [PeerAction.MidToleranceError]: -5,             // ~10 occurrences = ban
  [PeerAction.HighToleranceError]: -1,            // ~50 occurrences = ban
};
```

**File**: `packages/beacon-node/src/network/peers/score/constants.ts`

```typescript
export const MIN_SCORE_BEFORE_DISCONNECT = -20;
export const MIN_SCORE_BEFORE_BAN = -50;
```

For optional protocols returning `null`, **no score change occurs**, so the peer remains at the same priority level indefinitely.

---

## Recommendation

### Option 1: Use Identify Protocol Data (Preferred)

Store the `protocols` array from identify and check before making requests:

```typescript
// In peerManager.ts onLibp2pPeerConnect:
this.libp2p.services.identify
  .identify(evt.detail)
  .then((result) => {
    if (result.agentVersion) {
      peerData.agentVersion = result.agentVersion;
      peerData.agentClient = getKnownClientFromAgentVersion(result.agentVersion);
    }

    // NEW: Store supported protocols
    peerData.protocols = result.protocols;

    // NEW: Derive capabilities
    peerData.supportsLightClient = result.protocols.some(p =>
      p.includes('/eth2/beacon_chain/req/light_client')
    );
  })
```

Then in Network class:

```typescript
async sendLightClientBootstrap(peerId: PeerIdStr, request: Root): Promise<LightClientBootstrap> {
  // NEW: Check protocol support first
  const peerData = this.connectedPeers.get(peerId);
  if (peerData && peerData.supportsLightClient === false) {
    throw new Error(`Peer ${peerId} does not support LightClient protocols`);
  }

  return collectExactOneTyped(
    this.sendReqRespRequest(peerId, ReqRespMethod.LightClientBootstrap, [Version.V1], request),
    responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap]
  );
}
```

### Option 2: Track Failures (Fallback)

If Option 1 is not feasible, at least track failed attempts:

```typescript
// In PeerData
supportsLightClient: boolean | null;  // null = unknown, true/false = tested

// In onOutgoingRequestError
if (e.message.includes(libp2pErrorCodes.ERR_UNSUPPORTED_PROTOCOL)) {
  if (method.startsWith('LightClient')) {
    // Mark peer as not supporting LC
    const peerData = this.peersData.connectedPeers.get(peerId.toString());
    if (peerData) {
      peerData.supportsLightClient = false;
    }
  }
  // ... existing switch
}
```

### Benefits

1. **Zero additional network overhead** - identify is already being called
2. **Avoid wasted round trips** - don't ask peers that can't answer
3. **Better peer selection** - can prioritize LC-capable peers
4. **Cleaner error handling** - fail fast with clear error message

---

## Files Referenced

| File | Lines | Purpose |
|------|-------|---------|
| `network/peers/peerManager.ts` | 748-766 | Identify call, only extracts agentVersion |
| `network/network.ts` | 543-572 | LightClient send methods (no protocol check) |
| `network/network.ts` | 620-631 | sendReqRespRequest (no protocol check) |
| `network/reqresp/ReqRespBeaconNode.ts` | 318-323 | Error handling, calls onOutgoingReqRespError |
| `network/reqresp/score.ts` | 56-66 | UNSUPPORTED_PROTOCOL scoring (null for optional) |
| `network/peers/peersData.ts` | 22-35 | PeerData type (no protocols field) |
| `network/peers/score/store.ts` | 12-17 | Score deltas per action |
| `network/peers/score/constants.ts` | 6-8 | Ban/disconnect thresholds |
