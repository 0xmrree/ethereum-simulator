# Req/Resp Analysis for Light Client P2P

This document provides a detailed analysis of the req/resp (request/response) implementation in the Lodestar beacon node, with focus on understanding how to adapt it for the light client P2P networking layer.

## Table of Contents

1. [What is Req/Resp?](#what-is-reqresp)
2. [Main Structure and Classes](#main-structure-and-classes)
3. [All ReqResp Methods](#all-reqresp-methods)
4. [Light Client Specific Methods](#light-client-specific-methods)
5. [Protocol Versioning](#protocol-versioning)
6. [Request/Response Flow](#requestresponse-flow)
7. [Handler Registration](#handler-registration)
8. [Rate Limiting](#rate-limiting)
9. [Error Handling and Peer Scoring](#error-handling-and-peer-scoring)
10. [Dependencies](#dependencies)
11. [Code Examples](#code-examples)
12. [Key Files Reference](#key-files-reference)

---

## What is Req/Resp?

Req/Resp is the **pull-based** P2P protocol in Ethereum consensus. Unlike gossip (push-based), the **consumer initiates** the request:

- **Consumer** sends a request to a peer
- **Peer** processes and returns response(s)
- Uses **libp2p streams** over TCP
- Messages are **SSZ + Snappy** encoded

Key characteristics:
- Supports streaming responses (multiple items per request)
- Fork-aware with context bytes (fork digest)
- Per-peer rate limiting
- Peer scoring based on response quality

---

## Main Structure and Classes

### Primary Class: `ReqRespBeaconNode`

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

```typescript
export class ReqRespBeaconNode extends ReqResp {
  private readonly metadataController: MetadataController;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  private readonly networkEventBus: INetworkEventBus;
  private readonly peersData: PeersData;
  private readonly statusCache: StatusCache;
  private readonly getHandler: GetReqRespHandlerFn;
  private currentRegisteredFork: ForkSeq = ForkSeq.phase0;
  protected readonly disableLightClientServer: boolean;

  // Outbound request methods
  async sendPing(peerId: PeerId): Promise<phase0.Ping>;
  async sendStatus(peerId: PeerId, request: Status): Promise<Status>;
  async sendGoodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void>;
  async sendMetadata(peerId: PeerId): Promise<Metadata>;

  // Protocol management
  registerProtocolsAtBoundary(boundary: ForkBoundary): void;

  // Built-in handlers (yield responses)
  private async *onStatus(req, peerId): AsyncIterable<ResponseOutgoing>;
  private async *onGoodbye(req, peerId): AsyncIterable<ResponseOutgoing>;
  private async *onPing(req, peerId): AsyncIterable<ResponseOutgoing>;
  private async *onMetadata(req, peerId): AsyncIterable<ResponseOutgoing>;
}
```

### Constructor Modules

```typescript
export interface ReqRespBeaconNodeModules {
  libp2p: Libp2p;                    // Network transport
  peersData: PeersData;              // Peer metadata store
  logger: Logger;                    // Logging
  config: BeaconConfig;              // Fork schedule
  metrics: NetworkCoreMetrics | null; // Optional metrics
  metadata: MetadataController;      // Node's metadata
  peerRpcScores: IPeerRpcScoreStore; // Peer scoring
  events: INetworkEventBus;          // Event emission
  statusCache: StatusCache;          // Cached chain status
  getHandler: GetReqRespHandlerFn;   // Handler lookup function
}

export type ReqRespBeaconNodeOpts = ReqRespOpts & {
  disableLightClientServer?: boolean;  // Disable LC protocol serving
};
```

---

## All ReqResp Methods

**File:** `packages/beacon-node/src/network/reqresp/types.ts`

```typescript
export enum ReqRespMethod {
  // Phase 0 - Core protocols
  Status = "status",                           // Exchange chain status
  Goodbye = "goodbye",                         // Disconnect notification
  Ping = "ping",                               // Heartbeat/keepalive
  Metadata = "metadata",                       // Get peer metadata

  // Phase 0 - Block sync
  BeaconBlocksByRange = "beacon_blocks_by_range",  // Get blocks in slot range
  BeaconBlocksByRoot = "beacon_blocks_by_root",    // Get specific blocks

  // Deneb+ - Blob sync
  BlobSidecarsByRange = "blob_sidecars_by_range",
  BlobSidecarsByRoot = "blob_sidecars_by_root",

  // Fulu+ - Data column sync (PeerDAS)
  DataColumnSidecarsByRange = "data_column_sidecars_by_range",
  DataColumnSidecarsByRoot = "data_column_sidecars_by_root",

  // Altair+ - Light Client protocols
  LightClientBootstrap = "light_client_bootstrap",
  LightClientUpdatesByRange = "light_client_updates_by_range",
  LightClientFinalityUpdate = "light_client_finality_update",
  LightClientOptimisticUpdate = "light_client_optimistic_update",
}
```

### Request/Response Type Mapping

```typescript
// Request types
type RequestBodyByMethod = {
  [ReqRespMethod.Status]: Status;
  [ReqRespMethod.Goodbye]: phase0.Goodbye;
  [ReqRespMethod.Ping]: phase0.Ping;
  [ReqRespMethod.Metadata]: null;                              // No request data
  [ReqRespMethod.BeaconBlocksByRange]: phase0.BeaconBlocksByRangeRequest;
  [ReqRespMethod.BeaconBlocksByRoot]: BeaconBlocksByRootRequest;
  [ReqRespMethod.LightClientBootstrap]: Root;                  // Block root
  [ReqRespMethod.LightClientUpdatesByRange]: altair.LightClientUpdatesByRange;
  [ReqRespMethod.LightClientFinalityUpdate]: null;             // No request data
  [ReqRespMethod.LightClientOptimisticUpdate]: null;           // No request data
  // ... blobs, data columns
};

// Response types
type ResponseBodyByMethod = {
  [ReqRespMethod.Status]: Status;
  [ReqRespMethod.Goodbye]: phase0.Goodbye;
  [ReqRespMethod.Ping]: phase0.Ping;
  [ReqRespMethod.Metadata]: Metadata;
  [ReqRespMethod.BeaconBlocksByRange]: SignedBeaconBlock;      // Streamed
  [ReqRespMethod.BeaconBlocksByRoot]: SignedBeaconBlock;       // Streamed
  [ReqRespMethod.LightClientBootstrap]: LightClientBootstrap;
  [ReqRespMethod.LightClientUpdatesByRange]: LightClientUpdate; // Streamed
  [ReqRespMethod.LightClientFinalityUpdate]: LightClientFinalityUpdate;
  [ReqRespMethod.LightClientOptimisticUpdate]: LightClientOptimisticUpdate;
  // ... blobs, data columns
};
```

---

## Light Client Specific Methods

The light client needs these 4 req/resp methods (all Altair+):

### 1. LightClientBootstrap

**Purpose:** Initialize light client sync from a trusted block root

```typescript
// Request: Block root (32 bytes)
request: Root

// Response: Bootstrap data with sync committee proof
response: LightClientBootstrap {
  header: LightClientHeader,
  currentSyncCommittee: SyncCommittee,
  currentSyncCommitteeBranch: Vector<Bytes32, 5>
}
```

**Handler:** `packages/beacon-node/src/network/reqresp/handlers/lightClientBootstrap.ts`

```typescript
export async function* onLightClientBootstrap(
  requestBody: Root,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  const bootstrap = await chain.lightClientServer.getBootstrap(requestBody);
  const boundary = chain.config.getForkBoundaryAtEpoch(
    computeEpochAtSlot(bootstrap.header.beacon.slot)
  );

  yield {
    data: type.serialize(bootstrap),
    boundary,
  };
}
```

### 2. LightClientUpdatesByRange

**Purpose:** Sync light client through sync committee periods

```typescript
// Request: Period range
request: {
  startPeriod: SyncCommitteePeriod,
  count: number  // Max: MAX_REQUEST_LIGHT_CLIENT_UPDATES (128)
}

// Response: Stream of updates (one per period)
response: LightClientUpdate {
  attestedHeader: LightClientHeader,
  nextSyncCommittee: SyncCommittee,
  nextSyncCommitteeBranch: Vector<Bytes32, 5>,
  finalizedHeader: LightClientHeader,
  finalityBranch: Vector<Bytes32, 6>,
  syncAggregate: SyncAggregate,
  signatureSlot: Slot
}
```

### 3. LightClientFinalityUpdate

**Purpose:** Get the latest finality update

```typescript
// Request: null (no data)
request: null

// Response: Latest finality update
response: LightClientFinalityUpdate {
  attestedHeader: LightClientHeader,
  finalizedHeader: LightClientHeader,
  finalityBranch: Vector<Bytes32, 6>,
  syncAggregate: SyncAggregate,
  signatureSlot: Slot
}
```

### 4. LightClientOptimisticUpdate

**Purpose:** Get the latest optimistic (head) update

```typescript
// Request: null (no data)
request: null

// Response: Latest optimistic update
response: LightClientOptimisticUpdate {
  attestedHeader: LightClientHeader,
  syncAggregate: SyncAggregate,
  signatureSlot: Slot
}
```

---

## Protocol Versioning

**File:** `packages/beacon-node/src/network/reqresp/types.ts`

```typescript
export enum Version {
  V1 = 1,
  V2 = 2,
  V3 = 3,
}
```

### Version by Method and Fork

| Method | Pre-Altair | Altair-Fulu | Fulu+ |
|--------|------------|-------------|-------|
| Status | V1 | V1 | V2 |
| Metadata | V1 | V2, V3 | V3 |
| BeaconBlocksByRange | V1, V2 | V2 | V2 |
| BeaconBlocksByRoot | V1, V2 | V2 | V2 |
| LightClient* | N/A | V1 | V1 |

### Context Bytes

**File:** `packages/beacon-node/src/network/reqresp/protocols.ts`

```typescript
// Fork-agnostic protocols (no context bytes)
Status, Goodbye, Ping, Metadata → ContextBytesType.Empty

// Fork-specific protocols (include fork digest)
BeaconBlocksByRangeV2, BeaconBlocksByRootV2 → ContextBytesType.ForkDigest
BlobSidecars*, DataColumnSidecars* → ContextBytesType.ForkDigest
LightClient* → ContextBytesType.ForkDigest
```

The fork digest (4 bytes) is prepended to responses so the receiver knows which SSZ type to use for deserialization.

---

## Request/Response Flow

### Outgoing Request Flow (Light Client as Consumer)

```
1. Network.sendLightClientBootstrap(peerId, blockRoot)
   ↓
2. sendReqRespRequest(peerId, method, versions, request)
   ↓
3. Serialize request: requestSszTypeByMethod[method].serialize(request)
   ↓
4. ReqRespBeaconNode.sendRequestWithoutEncoding(peerId, method, versions, requestData)
   ↓
5. Get encoding preference from peersData (SSZ_SNAPPY)
   ↓
6. ReqResp.sendRequest() [base class from @lodestar/reqresp]
   ↓
7. libp2p opens stream to peer
   ↓
8. Peer processes request and streams response(s)
   ↓
9. collectExactOneTyped() / collectMaxResponseTyped() deserializes responses
   ↓
10. Return typed response to caller
```

### Incoming Request Flow (Beacon Node as Server)

```
1. libp2p receives protocol request from peer
   ↓
2. Protocol handler invoked (from getReqRespHandlers)
   ↓
3. Deserialize request: ssz.Root.deserialize(req.data)
   ↓
4. Handler processes: onLightClientBootstrap(body, chain)
   ↓
5. Fetch data: chain.lightClientServer.getBootstrap(blockRoot)
   ↓
6. Compute fork boundary for response
   ↓
7. yield { data: type.serialize(response), boundary }
   ↓
8. ReqResp serializes and sends to peer
```

---

## Handler Registration

### Handler Factory

**File:** `packages/beacon-node/src/network/reqresp/handlers/index.ts`

```typescript
export function getReqRespHandlers({db, chain}: {db: IBeaconDb; chain: IBeaconChain}): GetReqRespHandlerFn {
  const handlers: Record<ReqRespMethod, ProtocolHandler> = {
    // Built-in handlers (in ReqRespBeaconNode)
    [ReqRespMethod.Status]: notImplemented(ReqRespMethod.Status),
    [ReqRespMethod.Goodbye]: notImplemented(ReqRespMethod.Goodbye),
    [ReqRespMethod.Ping]: notImplemented(ReqRespMethod.Ping),
    [ReqRespMethod.Metadata]: notImplemented(ReqRespMethod.Metadata),

    // Block handlers
    [ReqRespMethod.BeaconBlocksByRange]: (req, peerId, peerClient) => {
      const body = ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req.data);
      return onBeaconBlocksByRange(body, chain, db, peerId, peerClient);
    },
    [ReqRespMethod.BeaconBlocksByRoot]: (req) => {
      const body = BeaconBlocksByRootRequestType(...).deserialize(req.data);
      return onBeaconBlocksByRoot(body, chain, db);
    },

    // Light client handlers
    [ReqRespMethod.LightClientBootstrap]: (req) => {
      const body = ssz.Root.deserialize(req.data);
      return onLightClientBootstrap(body, chain);
    },
    [ReqRespMethod.LightClientUpdatesByRange]: (req) => {
      const body = ssz.altair.LightClientUpdatesByRange.deserialize(req.data);
      return onLightClientUpdatesByRange(body, chain);
    },
    [ReqRespMethod.LightClientFinalityUpdate]: () => onLightClientFinalityUpdate(chain),
    [ReqRespMethod.LightClientOptimisticUpdate]: () => onLightClientOptimisticUpdate(chain),

    // ... blob and data column handlers
  };

  return (method) => handlers[method];
}
```

### Protocol Registration at Fork Boundaries

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

```typescript
registerProtocolsAtBoundary(boundary: ForkBoundary): void {
  this.currentRegisteredFork = ForkSeq[boundary.fork];

  const protocolsAtFork: [ProtocolNoHandler, ProtocolHandler][] = [
    // Always registered
    [protocols.Ping(fork, this.config), this.onPing.bind(this)],
    [protocols.Goodbye(fork, this.config), this.onGoodbye.bind(this)],
    [protocols.MetadataV3(fork, this.config), this.onMetadata.bind(this)],
    [protocols.BeaconBlocksByRangeV2(fork, this.config), this.getHandler(ReqRespMethod.BeaconBlocksByRange)],
    [protocols.BeaconBlocksByRootV2(fork, this.config), this.getHandler(ReqRespMethod.BeaconBlocksByRoot)],
  ];

  // Light client protocols (Altair+ and not disabled)
  if (ForkSeq[fork] >= ForkSeq.altair && !this.disableLightClientServer) {
    protocolsAtFork.push(
      [protocols.LightClientBootstrap(fork, this.config), this.getHandler(ReqRespMethod.LightClientBootstrap)],
      [protocols.LightClientFinalityUpdate(fork, this.config), this.getHandler(ReqRespMethod.LightClientFinalityUpdate)],
      [protocols.LightClientOptimisticUpdate(fork, this.config), this.getHandler(ReqRespMethod.LightClientOptimisticUpdate)],
      [protocols.LightClientUpdatesByRange(fork, this.config), this.getHandler(ReqRespMethod.LightClientUpdatesByRange)],
    );
  }

  // Register new protocols, unregister old ones
  // ...
}
```

---

## Rate Limiting

**File:** `packages/beacon-node/src/network/reqresp/rateLimit.ts`

### Per-Method Quotas

| Method | Quota | Time Window | Notes |
|--------|-------|-------------|-------|
| Status | 5 | 15s | |
| Goodbye | 1 | 10s | |
| Ping | 2 | 10s | |
| Metadata | 2 | 5s | |
| BeaconBlocksByRange | MAX_REQUEST_BLOCKS | 10s | Count by `req.count` |
| BeaconBlocksByRoot | MAX_REQUEST_BLOCKS | 10s | Count by `req.length` |
| **LightClientBootstrap** | 5 | 15s | Same as Status |
| **LightClientUpdatesByRange** | 128 | 10s | Count by `req.count` |
| **LightClientFinalityUpdate** | 2 | 12s | ~1 per slot |
| **LightClientOptimisticUpdate** | 2 | 12s | ~1 per slot |

### Rate Limit Enforcement

```typescript
// In ReqRespBeaconNode constructor
{
  onRateLimit(peerId, method) {
    logger.debug("Do not serve request due to rate limit", {peerId});
    peerRpcScores.applyAction(peerId, PeerAction.Fatal, "rate_limit_rpc");
    metrics?.reqResp.rateLimitErrors.inc({method});
  },
}
```

---

## Error Handling and Peer Scoring

**File:** `packages/beacon-node/src/network/reqresp/score.ts`

### Error to PeerAction Mapping

```typescript
export function onOutgoingReqRespError(e: RequestError, method: ReqRespMethod): PeerAction | null {
  switch (e.type.code) {
    // Immediate penalties
    case RequestErrorCode.INVALID_REQUEST:
    case RequestErrorCode.INVALID_RESPONSE_SSZ:
    case RequestErrorCode.SSZ_OVER_MAX_SIZE:
      return PeerAction.LowToleranceError;

    case RequestErrorCode.SERVER_ERROR:
      return PeerAction.MidToleranceError;

    case RequestErrorCode.UNKNOWN_ERROR_STATUS:
      return PeerAction.HighToleranceError;

    // Timeout handling varies by method
    case RequestErrorCode.TTFB_TIMEOUT:
    case RequestErrorCode.RESP_TIMEOUT:
      switch (method) {
        case ReqRespMethod.Ping:
        case ReqRespMethod.Status:
        case ReqRespMethod.Metadata:
          return PeerAction.LowToleranceError;
        case ReqRespMethod.BeaconBlocksByRange:
        case ReqRespMethod.BeaconBlocksByRoot:
          return PeerAction.MidToleranceError;
        default:
          return null;  // No penalty for LC timeouts
      }
  }

  // Protocol not supported
  if (e.message.includes("ERR_UNSUPPORTED_PROTOCOL")) {
    if (method === ReqRespMethod.Ping) return PeerAction.Fatal;
    if (method === ReqRespMethod.Status || method === ReqRespMethod.Metadata) {
      return PeerAction.LowToleranceError;
    }
    return null;  // No penalty for unsupported LC protocols
  }

  return null;
}
```

### Response Error Codes

```typescript
enum RespStatus {
  SUCCESS = 0,
  INVALID_REQUEST = 1,
  SERVER_ERROR = 2,
  RESOURCE_UNAVAILABLE = 3,  // Used by LC handlers
}
```

---

## Dependencies

### External Packages

```json
{
  "@lodestar/reqresp": "*",        // Base ReqResp class, protocol handling
  "@lodestar/types": "*",          // SSZ types for all messages
  "@lodestar/config": "*",         // BeaconConfig, fork boundaries
  "@lodestar/params": "*",         // MAX_REQUEST_LIGHT_CLIENT_UPDATES, ForkSeq
  "@lodestar/state-transition": "*" // computeEpochAtSlot
}
```

### Internal Dependencies

| Module | Usage |
|--------|-------|
| `IBeaconChain` | Access to lightClientServer, clock, config |
| `IBeaconDb` | Block/blob storage for serving requests |
| `PeerRpcScoreStore` | Peer reputation scoring |
| `MetadataController` | Node's metadata for Ping/Metadata responses |
| `StatusCache` | Cached chain status for Status responses |
| `PeersData` | Peer encoding preferences |

---

## Code Examples

### Example 1: Sending a Light Client Request (Network Class)

**File:** `packages/beacon-node/src/network/network.ts`

```typescript
// Lines 543-548
async sendLightClientBootstrap(peerId: PeerIdStr, request: Root): Promise<LightClientBootstrap> {
  return collectExactOneTyped(
    this.sendReqRespRequest(peerId, ReqRespMethod.LightClientBootstrap, [Version.V1], request),
    responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap]
  );
}

// Lines 550-555
async sendLightClientOptimisticUpdate(peerId: PeerIdStr): Promise<LightClientOptimisticUpdate> {
  return collectExactOneTyped(
    this.sendReqRespRequest(peerId, ReqRespMethod.LightClientOptimisticUpdate, [Version.V1], null),
    responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate]
  );
}

// Lines 564-573
async sendLightClientUpdatesByRange(
  peerId: PeerIdStr,
  request: altair.LightClientUpdatesByRange
): Promise<LightClientUpdate[]> {
  return collectMaxResponseTyped(
    this.sendReqRespRequest(peerId, ReqRespMethod.LightClientUpdatesByRange, [Version.V1], request),
    request.count,
    responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange]
  );
}

// Lines 620-632
private sendReqRespRequest<Req>(
  peerId: PeerIdStr,
  method: ReqRespMethod,
  versions: number[],
  request: Req
): AsyncIterable<ResponseIncoming> {
  const fork = this.config.getForkName(this.clock.currentSlot);
  const requestType = requestSszTypeByMethod(fork, this.config)[method];
  const requestData = requestType ? requestType.serialize(request as never) : new Uint8Array();

  return this.core.sendReqRespRequest({peerId, method, versions, requestData});
}
```

### Example 2: Protocol Definition

**File:** `packages/beacon-node/src/network/reqresp/protocols.ts`

```typescript
// Lines 97-119
export const LightClientBootstrap = toProtocol({
  method: ReqRespMethod.LightClientBootstrap,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,  // Response includes fork digest
});

export const LightClientFinalityUpdate = toProtocol({
  method: ReqRespMethod.LightClientFinalityUpdate,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientOptimisticUpdate = toProtocol({
  method: ReqRespMethod.LightClientOptimisticUpdate,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

export const LightClientUpdatesByRange = toProtocol({
  method: ReqRespMethod.LightClientUpdatesByRange,
  version: Version.V1,
  contextBytesType: ContextBytesType.ForkDigest,
});

// Lines 127-136
function toProtocol(protocol: ProtocolSummary) {
  return (fork: ForkName, config: BeaconConfig): ProtocolNoHandler => ({
    method: protocol.method,
    version: protocol.version,
    encoding: Encoding.SSZ_SNAPPY,
    contextBytes: toContextBytes(protocol.contextBytesType, config),
    inboundRateLimits: rateLimitQuotas(fork, config)[protocol.method],
    requestSizes: requestSszTypeByMethod(fork, config)[protocol.method],
    responseSizes: (fork) => responseSszTypeByMethod[protocol.method](fork, protocol.version),
  });
}
```

### Example 3: Response Collection Utilities

**File:** `packages/beacon-node/src/network/reqresp/utils/collect.ts`

```typescript
// Collect exactly one response (Bootstrap, FinalityUpdate, OptimisticUpdate)
export async function collectExactOneTyped<T>(
  source: AsyncIterable<ResponseIncoming>,
  typeFn: ResponseTypeGetter<T>
): Promise<T> {
  for await (const chunk of source) {
    return sszDeserializeResponse(typeFn, chunk);
  }
  throw new Error("Expected exactly one response, got zero");
}

// Collect up to N responses (UpdatesByRange, BlocksByRange)
export async function collectMaxResponseTyped<T>(
  source: AsyncIterable<ResponseIncoming>,
  maxResponses: number,
  typeFn: ResponseTypeGetter<T>
): Promise<T[]> {
  const responses: T[] = [];
  for await (const chunk of source) {
    responses.push(sszDeserializeResponse(typeFn, chunk));
    if (responses.length >= maxResponses) break;
  }
  return responses;
}
```

### Example 4: Built-in Handler (Metadata)

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

```typescript
// Lines 361-374
private async *onMetadata(req: ReqRespRequest, peerId: PeerId): AsyncIterable<ResponseOutgoing> {
  // Notify event bus of incoming request
  this.onIncomingRequestBody({method: ReqRespMethod.Metadata, body: null}, peerId);

  // Get current metadata from controller
  const metadata = this.metadataController.json;

  // Get SSZ type based on protocol version (V1, V2, or V3)
  const type = responseSszTypeByMethod[ReqRespMethod.Metadata](ForkName.phase0, req.version);

  yield {
    data: type.serialize(metadata),
    boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},  // Fork-agnostic
  };
}
```

---

## Key Files Reference

| File | Path | Purpose |
|------|------|---------|
| **ReqRespBeaconNode** | `beacon-node/src/network/reqresp/ReqRespBeaconNode.ts` | Main class, protocol registration, built-in handlers |
| **Types** | `beacon-node/src/network/reqresp/types.ts` | Method enum, SSZ type maps, versioning |
| **Protocols** | `beacon-node/src/network/reqresp/protocols.ts` | Protocol definitions with context bytes |
| **Score** | `beacon-node/src/network/reqresp/score.ts` | Error → PeerAction mapping |
| **Rate Limit** | `beacon-node/src/network/reqresp/rateLimit.ts` | Per-method quotas |
| **Handlers Index** | `beacon-node/src/network/reqresp/handlers/index.ts` | Handler factory |
| **LC Bootstrap** | `beacon-node/src/network/reqresp/handlers/lightClientBootstrap.ts` | Bootstrap handler |
| **LC Updates** | `beacon-node/src/network/reqresp/handlers/lightClientUpdatesByRange.ts` | Updates handler |
| **LC Finality** | `beacon-node/src/network/reqresp/handlers/lightClientFinalityUpdate.ts` | Finality handler |
| **LC Optimistic** | `beacon-node/src/network/reqresp/handlers/lightClientOptimisticUpdate.ts` | Optimistic handler |
| **Collect Utils** | `beacon-node/src/network/reqresp/utils/collect.ts` | Response collection |
| **Network** | `beacon-node/src/network/network.ts` | High-level send methods |

---

## Summary: What the Light Client Needs

### As a Consumer (Making Requests)

The light client needs to **send** these requests to beacon node peers:

1. **LightClientBootstrap** - Initialize sync from trusted block root
2. **LightClientUpdatesByRange** - Sync through committee periods
3. **LightClientFinalityUpdate** - Get latest finality proof
4. **LightClientOptimisticUpdate** - Get latest head proof

It also needs core protocols for peer management:
- **Status** - Exchange chain status on connect
- **Ping** - Heartbeat/keepalive
- **Metadata** - Exchange node metadata
- **Goodbye** - Clean disconnect

### As a Server (Handling Requests)

The light client probably does NOT need to serve light client data, but it MUST respond to:
- **Status** - Return its perceived chain status
- **Ping** - Return its metadata sequence number
- **Metadata** - Return its metadata (can be minimal: empty attnets/syncnets)
- **Goodbye** - Acknowledge disconnect

### Simplified Implementation

For the light client:

1. **Reuse `@lodestar/reqresp`** - Base ReqResp class handles protocol mechanics
2. **Implement minimal handlers** - Status, Ping, Metadata, Goodbye
3. **Focus on send methods** - The 4 light client request types
4. **Skip serving** - No need to serve light client data to others
5. **Simpler peer scoring** - Can use reduced penalty logic
6. **No fork-based protocol switching** - Just register Altair+ protocols

The light client can use a much thinner wrapper around `@lodestar/reqresp` compared to the full `ReqRespBeaconNode`, since it's primarily a consumer rather than a server.

---

## Additional Notes for Light Client Implementation

These notes capture key insights discovered during analysis:

### Stateful vs Stateless Connections
- Unlike HTTP (stateless, each request independent), libp2p maintains persistent TCP connections with peers.
- Peers remember your peer ID, score you over time, and track metadata about the connection.
- Disconnecting has consequences: triggers reconnection logic, affects reputation, requires Goodbye notification.

### Peer Scoring
- The **requester** scores the **responder** based on response quality (valid SSZ, no timeout, correct data).
- Scores are **negative only**: 0 is healthy (best), more negative is worse; there are no positive rewards.
- "Decay" means scores **recover toward zero** over time, so transient issues are eventually forgiven.
- PeerAction is the penalty type: Fatal (instant ban, -100), LowTolerance (-10), MidTolerance (-5), HighTolerance (-1).
- Light client timeouts on LC-specific methods return `null` (no penalty), since not all peers serve light client data.

### Goodbye Protocol
- Goodbye is structurally identical to any other req/resp method: request data in, response data out.
- It's semantically a notification ("I'm leaving, reason=X") with an acknowledgment response (reason=0).
- Without Goodbye, the disconnected peer might think you crashed and immediately try to reconnect.
- The reason code tells the peer why: TOO_MANY_PEERS, BANNED, IRRELEVANT_NETWORK, CLIENT_SHUTDOWN, etc.

### Protocol Versioning vs Fork Digest
- **Protocol version** (V1/V2/V3) handles changes to the protocol structure itself (e.g., Metadata adding syncnets in V2).
- **Fork digest** (context bytes) handles changes to the data payload SSZ schema (e.g., different block types per fork).
- Versions are negotiated via the libp2p protocol ID string; fork digest is prepended to response payloads.
- Versions are loosely tied to forks: V1=Phase0, V2=Altair, V3=Fulu, but not every fork bumps every version.

### Protocol Registration
- "Registering a protocol" means telling libp2p to route incoming streams with a specific protocol ID to your handler function.
- Protocol IDs look like: `/eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy`.
- At fork boundaries, the node registers new protocols and unregisters obsolete ones to match the current fork.
- Unregistered protocols return ERR_UNSUPPORTED_PROTOCOL to the requester.

### Stream and Message Format
- libp2p multiplexes many logical streams over one TCP connection using yamux.
- Opening a stream involves multistream-select negotiation: both sides exchange the protocol ID string before any data flows.
- Once negotiated, the stream only carries SSZ+Snappy payloads; the protocol ID is NOT repeated per message.
- Both gossip and req/resp use SSZ+Snappy for payload encoding, but the framing (wrapper) differs.
- Req/resp framing: `[status_code][context_bytes][varint_length][snappy(ssz(payload))]`.
- Gossip framing: protobuf envelope with topic string, sender, sequence number, signature, and the `snappy(ssz(payload))`.

### Ethereum P2P Message Layers
- Layer 1 (Discovery): discv5 over UDP, RLP-encoded, for finding peers.
- Layer 2 (Req/Resp): libp2p streams over TCP, SSZ+Snappy, for point-to-point request/response.
- Layer 3 (Gossip): gossipsub over TCP, SSZ+Snappy, for broadcast pub/sub to mesh peers.

### StatusCache
- StatusCache holds the node's current chain status (forkDigest, finalizedRoot, finalizedEpoch, headRoot, headSlot).
- Updated when head or finality changes, not on every request; avoids recomputing from fork choice on each Status response.
- Light client will need its own version based on the latest verified light client header.

### computeEpochAtSlot vs Clock
- Clock tells you "what is the current slot right now" based on wall time and genesis time.
- `computeEpochAtSlot` is a pure math function (`Math.floor(slot / 32)`) for converting any slot to its epoch.
- You need `computeEpochAtSlot` for processing historical/future data, not just the current moment.

### What ReqRespBeaconNode Does vs Light Client Version
- ReqRespBeaconNode is a full server+client: serves blocks, blobs, LC data to peers AND requests data for sync.
- A light client version only needs: outbound LC requests (Bootstrap, Updates, Finality, Optimistic) + minimal inbound handlers (Status, Ping, Metadata, Goodbye).
- The light client MUST register and respond to Status/Ping/Metadata/Goodbye or peers will disconnect it.
- The light client does NOT need to register handlers for block, blob, or LC serving protocols.

### Response Collection
- `ResponseIncoming` already has the fork name extracted from context bytes by the `@lodestar/reqresp` base layer.
- You don't need to manually parse fork digest from raw bytes; it arrives as `chunk.fork` in the async iterator.
- `collectExactOneTyped` is for single-response protocols (Bootstrap, FinalityUpdate, OptimisticUpdate).
- `collectMaxResponseTyped` is for streaming protocols (UpdatesByRange) that return multiple items.

### Rate Limiting
- Rate limits are **per-peer**, not global; each peer has its own quota bucket.
- Exceeding the rate limit results in PeerAction.Fatal (immediate ban).
- Light client rate limits when requesting are defined by the serving peer, not by the light client itself.

### Peer ID
- Peer ID is a multihash of the protobuf-encoded secp256k1 public key, using SHA-256 (not keccak).
- Different from Ethereum addresses which use keccak256 of the public key.
