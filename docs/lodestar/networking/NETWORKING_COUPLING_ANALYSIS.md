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
  chain: IBeaconChain; // <-- Requires full beacon chain interface
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

## 2. ReqResp Coupling

**File:** `packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts`

`ReqRespBeaconNode` extends the base `ReqResp` class from `@lodestar/reqresp` and adds beacon-node specific modules (StatusCache, MetadataController, PeersData, peer scoring, event bus, request handlers).

**Solution:** The base `ReqResp` class in `@lodestar/reqresp` has no beacon-node dependencies. The light client needs to implement a `ReqRespLightClient` that extends `ReqResp` directly - dial-only (no request handlers), with simplified peer management.

---

## 3. Discv5 Coupling

### Example 3.1: Discv5WorkerData Type

**File:** `packages/beacon-node/src/network/discv5/types.ts`

```typescript
/** discv5 worker constructor data */
export interface Discv5WorkerData {
  enr: string;
  privateKeyProto: Uint8Array;
  bindAddrs: BindAddrs;
  config: Discv5Config;
  bootEnrs: string[];
  metrics: boolean; // <-- Optional, light client can skip
  chainConfig: ChainConfig; // <-- Beacon-node chain config
  genesisValidatorsRoot: Uint8Array; // <-- Beacon-node specific
  loggerOpts: LoggerNodeOpts;
  genesisTime: number; // <-- Beacon-node specific
}
```

**Problem:** The `Discv5WorkerData` type requires beacon-node specific data: `chainConfig`, `genesisValidatorsRoot`, and `genesisTime`. These come from the beacon chain state.

### What Discv5WorkerData is used for

The beacon-node runs discv5 in a **separate worker thread** for performance. The worker uses this data to:

1. **Create a BeaconConfig** (`chainConfig` + `genesisValidatorsRoot`) - needed to understand fork schedules
2. **Create a Clock** (`genesisTime`) - needed to know the current slot/epoch
3. **Filter discovered peers by fork relevance** - Only connect to peers on the same fork

**File:** `packages/beacon-node/src/network/discv5/worker.ts`

```typescript
// Line 48 - Create beacon config for fork checking
const config = createBeaconConfig(workerData.chainConfig, workerData.genesisValidatorsRoot);

// Line 72 - Create clock to know current slot
const clock = new Clock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

// Lines 74-80 - Filter peers by fork relevance
const onDiscovered = (enr: ENR): void => {
  const status = enrRelevance(enr, config, clock); // Check if peer's fork matches ours
  if (status === ENRRelevance.relevant) {
    subject.next(enr.toObject()); // Only return relevant peers
  }
};
```

**Solution:** The `@chainsafe/discv5` library is usable directly. The light client can:

- Run discv5 on the main thread (no worker needed for lighter-weight client)
- Still do fork filtering, but obtain `chainConfig`, `genesisValidatorsRoot`, and `genesisTime` from the trusted bootstrap/checkpoint
- Skip metrics for now

---

## Summary Table

| Component   | File                   | Coupling           | Impact                                                               |
| ----------- | ---------------------- | ------------------ | -------------------------------------------------------------------- |
| **Gossip**  | `interface.ts:135`     | `IBeaconChain`     | Can't use without full chain                                         |
| **Gossip**  | `gossipsub.ts:309`     | `NetworkEventBus`  | Messages go through beacon event system                              |
| **Gossip**  | `gossipsub.ts:302`     | `PeersData`        | Requires tracking beacon-chain peer state (finalized root, subnets)  |
| **ReqResp** | `ReqRespBeaconNode.ts` | Multiple modules   | Need to implement `ReqRespLightClient` extending base `ReqResp`      |
| **Discv5**  | `types.ts:32-43`       | `Discv5WorkerData` | Needs chainConfig, genesisValidatorsRoot, genesisTime from bootstrap |

---
