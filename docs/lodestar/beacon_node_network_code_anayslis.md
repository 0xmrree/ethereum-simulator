# Beacon-Node Networking Code Coupling Analysis

This document analyzes the tight coupling between beacon-node networking code and beacon-node specific modules. This coupling makes it difficult to reuse networking code in the light-client without creating circular dependencies.

## Overview

The beacon-node networking stack consists of three main components:
1. **Gossipsub** - Pub/sub messaging for live updates
2. **ReqResp** - Request/response protocols for fetching data
3. **Discv5** - Peer discovery via DHT

Each component has dependencies on beacon-node specific modules that would create circular dependencies if extracted to a shared package.

---

## 1. Gossipsub Coupling

### Example 1.1: Chain Dependency in `interface.ts`

**File:** `packages/beacon-node/src/network/gossip/interface.ts`

```typescript
// Lines 21-24 - Imports
import {AttestationError, AttestationErrorType} from "../../chain/errors/attestationError.js";
import {GossipActionError} from "../../chain/errors/gossipValidation.js";
import {IBeaconChain} from "../../chain/index.js";
import {JobItemQueue} from "../../util/queue/index.js";

// Lines 131-136 - Usage
export type GossipModules = {
  config: BeaconConfig;
  libp2p: Libp2p;
  logger: Logger;
  chain: IBeaconChain;  // <-- Requires full beacon chain interface
};
```

**Problem:** `GossipModules` requires `IBeaconChain`, which is the entire beacon chain state machine. A light client doesn't have a beacon chain - it just wants to receive gossip messages.

---

### Example 1.2: Event System in `gossipsub.ts`

**File:** `packages/beacon-node/src/network/gossip/gossipsub.ts`

```typescript
// Line 11 - Import
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../events.js";

// Lines 308-320 - Usage in onGossipsubMessage()
callInNextEventLoop(() => {
  this.events.emit(NetworkEvent.pendingGossipsubMessage, {
    topic,
    msg,
    msgId,
    propagationSource: peerIdStr,
    clientVersion,
    clientAgent,
    seenTimestampSec,
    startProcessUnixSec: null,
  });
});
```

**Problem:** When a gossip message arrives, it's not returned directly - it's emitted through `NetworkEventBus` which is beacon-node's internal event system. The light client would need to implement this entire event infrastructure or refactor to use callbacks/promises instead.

---

### Example 1.3: Error Types in `topic.ts`

**File:** `packages/beacon-node/src/network/gossip/topic.ts`

```typescript
// Line 11 - Import
import {GossipAction, GossipActionError, GossipErrorCode} from "../../chain/errors/gossipValidation.js";

// Lines 123-130 - Usage in sszDeserialize()
export function sszDeserialize<T extends GossipTopic>(topic: T, serializedData: Uint8Array): SSZTypeOfGossipTopic<T> {
  const sszType = getGossipSSZType(topic);
  try {
    return sszType.deserialize(serializedData) as SSZTypeOfGossipTopic<T>;
  } catch (_e) {
    throw new GossipActionError(GossipAction.REJECT, {code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE});
  }
}
```

**Problem:** Even simple deserialization throws beacon-node specific error types (`GossipActionError`). These errors are designed to integrate with beacon-node's gossip validation pipeline which decides whether to ACCEPT, REJECT, or IGNORE messages.

---

## 2. ReqResp Coupling

### Example 2.1: Module Dependencies in `ReqRespBeaconNode.ts`

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

```typescript
// Lines 18-25 - Imports
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {INetworkEventBus, NetworkEvent} from "../events.js";
import {MetadataController} from "../metadata.js";
import {ClientKind} from "../peers/client.ts";
import {PeersData} from "../peers/peersData.js";
import {IPeerRpcScoreStore, PeerAction} from "../peers/score/index.js";
import {StatusCache} from "../statusCache.js";

// Lines 42-53 - Usage
export interface ReqRespBeaconNodeModules {
  libp2p: Libp2p;
  peersData: PeersData;           // <-- Beacon-node peer tracking
  logger: Logger;
  config: BeaconConfig;
  metrics: NetworkCoreMetrics | null;  // <-- Beacon-node metrics
  metadata: MetadataController;    // <-- Beacon-node metadata
  peerRpcScores: IPeerRpcScoreStore;  // <-- Beacon-node peer scoring
  events: INetworkEventBus;        // <-- Beacon-node event bus
  statusCache: StatusCache;        // <-- Beacon-node status cache
  getHandler: GetReqRespHandlerFn; // <-- Beacon-node request handlers
}
```

**Problem:** `ReqRespBeaconNode` extends the base `ReqResp` class but requires many beacon-node specific modules: peer scoring, metrics, event bus, status cache, metadata controller, etc.

---

### Example 2.2: Peer Scoring Integration

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

```typescript
// Lines 88-91 - Rate limit handling with peer scoring
onRateLimit(peerId, method) {
  logger.debug("Do not serve request due to rate limit", {peerId: peerId.toString()});
  peerRpcScores.applyAction(peerId, PeerAction.Fatal, "rate_limit_rpc");
  metrics?.reqResp.rateLimitErrors.inc({method});
},
```

**Problem:** Rate limiting is directly tied to the peer scoring system (`peerRpcScores.applyAction`). The light client would need to either implement a compatible scoring system or stub this out.

---

### Example 2.3: Handler Registration

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

```typescript
// Lines 123-147 - Protocol registration with handlers
registerProtocolsAtBoundary(boundary: ForkBoundary): void {
  this.currentRegisteredFork = ForkSeq[boundary.fork];

  const mustSubscribeProtocols = this.getProtocolsAtBoundary(boundary);
  // ...
  for (const [protocol, handler] of mustSubscribeProtocols) {
    this.registerProtocol({...protocol, handler}).catch((e) => {
      this.logger.error("Error on ReqResp.registerProtocol", {protocolID: this.formatProtocolID(protocol)}, e);
    });
  }
}
```

**Problem:** Protocol registration includes handlers that reference `this.getHandler`, which provides beacon-node specific request handling (block requests, attestation requests, etc.). Light clients only need dial-only protocols without handlers.

**Note:** We partially solved this by moving protocol definitions to `@lodestar/reqresp/protocols` and using `registerDialOnlyProtocol()` in the light client.

---

## 3. Discv5 Coupling

### Example 3.1: Metrics Dependency in `index.ts`

**File:** `packages/beacon-node/src/network/discv5/index.ts`

```typescript
// Line 9 - Import
import {NetworkCoreMetrics} from "../core/metrics.js";

// Lines 12-19 - Usage
export type Discv5Opts = {
  privateKey: PrivateKey;
  discv5: LodestarDiscv5Opts;
  logger: LoggerNode;
  config: BeaconConfig;
  genesisTime: number;
  metrics?: NetworkCoreMetrics;  // <-- Beacon-node metrics
};

// Line 129 - Usage
this.opts.metrics?.discv5.decodeEnrAttemptCount.inc(1);
```

**Problem:** The `Discv5Worker` takes beacon-node specific metrics. While this is optional, it means the light client either gets no metrics or needs to implement compatible metrics.

---

### Example 3.2: Worker Data Dependencies

**File:** `packages/beacon-node/src/network/discv5/index.ts`

```typescript
// Lines 42-53 - Worker initialization
const workerData: Discv5WorkerData = {
  enr: opts.discv5.enr,
  privateKeyProto: privateKeyToProtobuf(opts.privateKey),
  bindAddrs: opts.discv5.bindAddrs,
  config: opts.discv5.config ?? {},
  bootEnrs: opts.discv5.bootEnrs,
  metrics: Boolean(opts.metrics),
  chainConfig: chainConfigFromJson(chainConfigToJson(opts.config)),
  genesisValidatorsRoot: opts.config.genesisValidatorsRoot,
  loggerOpts: opts.logger.toOpts(),
  genesisTime: opts.genesisTime,  // <-- Beacon-node specific
};
```

**Problem:** Worker initialization requires `genesisTime` which comes from the beacon chain. Light clients have a different way of determining genesis time (from their trusted checkpoint).

---

### Example 3.3: Logger Type

**File:** `packages/beacon-node/src/network/discv5/types.ts`

```typescript
// Line 5 - Import
import {LoggerNodeOpts} from "@lodestar/logger/node";

// Line 41 - Usage
loggerOpts: LoggerNodeOpts;
```

**Problem:** Uses `LoggerNodeOpts` from `@lodestar/logger/node`, which is Node.js specific. Light clients running in browsers would need a different logger implementation.

---

## Summary Table

| Component | File | Coupling | Impact |
|-----------|------|----------|--------|
| **Gossip** | `interface.ts:135` | `IBeaconChain` | Can't use without full chain |
| **Gossip** | `gossipsub.ts:309` | `NetworkEventBus` | Messages go through beacon event system |
| **Gossip** | `topic.ts:128` | `GossipActionError` | Basic functions throw beacon errors |
| **ReqResp** | `ReqRespBeaconNode.ts:44-52` | Multiple modules | Needs peer data, metrics, events, status |
| **ReqResp** | `ReqRespBeaconNode.ts:90` | `PeerAction` | Rate limiting tied to peer scoring |
| **Discv5** | `index.ts:18` | `NetworkCoreMetrics` | Optional but beacon-specific metrics |
| **Discv5** | `index.ts:52` | `genesisTime` | Requires beacon chain genesis info |

---

## Recommendations

### Option A: Create `@lodestar/network` Package
Extract shareable pieces (types, topic utilities, protocol definitions) into a new package. Both beacon-node and light-client import from it.

**Pros:** Clean separation, DRY
**Cons:** Significant refactoring, risk of breaking beacon-node

### Option B: Copy and Simplify
Copy networking code into light-client and strip beacon-node dependencies.

**Pros:** Fast to implement, no risk to beacon-node
**Cons:** Code duplication, maintenance burden

### Option C: Dependency Inversion
Define interfaces in a shared package, keep implementations separate. Beacon-node and light-client each provide their own implementations.

**Pros:** Minimal code movement, clean interfaces
**Cons:** Requires refactoring beacon-node to accept interfaces

### Current Approach
We've taken a hybrid approach:
1. **ReqResp:** Moved protocol definitions to `@lodestar/reqresp/protocols` (shared)
2. **Gossip:** Created minimal implementation in light-client (separate)
3. **Discv5:** Not yet addressed

This allows incremental progress while minimizing risk to the existing beacon-node codebase.
