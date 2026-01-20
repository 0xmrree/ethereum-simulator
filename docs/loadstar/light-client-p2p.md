# Lodestar P2P Light Client Transport - Implementation Spec

## Issue References
- **Primary Issue**: https://github.com/ChainSafe/lodestar/issues/5644
- **Parent Issue**: https://github.com/ChainSafe/lodestar/issues/4706
- **P2P Spec**: https://github.com/ethereum/consensus-specs/blob/dev/specs/altair/light-client/p2p-interface.md

---

## Goal

Implement a new `LightClientP2PTransport` class that allows the light client to sync and stay current via the Ethereum P2P network instead of requiring a beacon node REST API.

**Current state**: Light client requires a running beacon node and connects via REST API + SSE events.

**Target state**: Light client joins the P2P network directly, discovers peers via discv5, syncs via req/resp, and receives updates via gossipsub.

---

## Implementation Approach (from maintainer)

1. Copy/paste needed P2P code from `packages/beacon-node` into `packages/light-client`
2. Get it working first, don't worry about DRY
3. Refactor into shared package later

---

## Interface to Implement

Location: `packages/light-client/src/transport/interface.ts`

```typescript
import {ForkName} from "@lodestar/params";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  SyncPeriod,
} from "@lodestar/types";

export interface LightClientTransport {
  getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<{version: ForkName; data: LightClientUpdate}[]>;

  getOptimisticUpdate(): Promise<{version: ForkName; data: LightClientOptimisticUpdate}>;

  getFinalityUpdate(): Promise<{version: ForkName; data: LightClientFinalityUpdate}>;

  getBootstrap(blockRoot: string): Promise<{version: ForkName; data: LightClientBootstrap}>;

  onOptimisticUpdate(handler: (optimisticUpdate: LightClientOptimisticUpdate) => void): void;

  onFinalityUpdate(handler: (finalityUpdate: LightClientFinalityUpdate) => void): void;
}
```

---

## P2P Protocol Details

### Req/Resp Protocols (for sync and catch-up)

These are request/response protocols. The light client sends requests to beacon node peers.

#### 1. GetLightClientBootstrap

```
Protocol ID: /eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy

Request:  Root (32 bytes) - the checkpoint block root
Response: LightClientBootstrap

Purpose: Get initial sync committee and header for a trusted checkpoint
```

Maps to: `getBootstrap(blockRoot: string)`

#### 2. LightClientUpdatesByRange

```
Protocol ID: /eth2/beacon_chain/req/light_client_updates_by_range/1/ssz_snappy

Request: {
  start_period: uint64
  count: uint64
}
Response: LightClientUpdate[] (one per period)

Purpose: Get sync committee transitions for a range of periods
```

Maps to: `getUpdates(startPeriod: SyncPeriod, count: number)`

#### 3. GetLightClientFinalityUpdate

```
Protocol ID: /eth2/beacon_chain/req/light_client_finality_update/1/ssz_snappy

Request:  (empty)
Response: LightClientFinalityUpdate

Purpose: Get the latest finality update (for catch-up after sync)
```

Maps to: `getFinalityUpdate()`

#### 4. GetLightClientOptimisticUpdate

```
Protocol ID: /eth2/beacon_chain/req/light_client_optimistic_update/1/ssz_snappy

Request:  (empty)
Response: LightClientOptimisticUpdate

Purpose: Get the latest optimistic update (for catch-up after sync)
```

Maps to: `getOptimisticUpdate()`

---

### Gossip Topics (for staying at chain tip)

These are pub/sub topics. The light client subscribes to receive updates and relays messages to other peers.

#### 1. light_client_optimistic_update

```
Topic: /eth2/{fork_digest}/light_client_optimistic_update/ssz_snappy

Message: LightClientOptimisticUpdate

Purpose: Receive latest head signed by sync committee (~every 12 seconds)
```

Maps to: `onOptimisticUpdate(handler)`

#### 2. light_client_finality_update

```
Topic: /eth2/{fork_digest}/light_client_finality_update/ssz_snappy

Message: LightClientFinalityUpdate

Purpose: Receive latest finalized checkpoint signed by sync committee
```

Maps to: `onFinalityUpdate(handler)`

---

## File Structure

Create new files in `packages/light-client/src/transport/`:

```
packages/light-client/src/transport/
├── interface.ts        # Already exists - the interface
├── rest.ts             # Already exists - REST implementation (reference this)
├── p2p.ts              # NEW - P2P implementation
└── index.ts            # Update to export new transport
```

---

## Class Skeleton

```typescript
// packages/light-client/src/transport/p2p.ts

import mitt, {Emitter} from "mitt";
import {ForkName} from "@lodestar/params";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  SyncPeriod,
} from "@lodestar/types";
import {LightClientTransport} from "./interface.js";

export type LightClientP2PTransportConfig = {
  // Bootnodes to connect to initially
  bootnodes: string[];
  // Network config (mainnet, sepolia, etc)
  networkConfig: {...};
};

export class LightClientP2PTransport implements LightClientTransport {
  // P2P components (copy from beacon-node)
  private libp2p: Libp2p;
  private discv5: Discv5;
  private gossipsub: GossipSub;
  
  // Event handling (same pattern as REST transport)
  private readonly eventEmitter = mitt();
  private subscribedToGossip = false;
  
  constructor(config: LightClientP2PTransportConfig) {
    // Initialize libp2p, discv5, gossipsub
    // Connect to bootnodes
    // Start peer discovery
  }

  //
  // REQ/RESP METHODS (pull-based, for sync)
  //

  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: LightClientBootstrap}> {
    // 1. Select a peer from discovered peers
    // 2. Send request on protocol: /eth2/beacon_chain/req/light_client_bootstrap/1/ssz_snappy
    // 3. Decode SSZ response
    // 4. Return with fork version from context bytes
  }

  async getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<{version: ForkName; data: LightClientUpdate}[]> {
    // 1. Select a peer
    // 2. Send request on protocol: /eth2/beacon_chain/req/light_client_updates_by_range/1/ssz_snappy
    // 3. Request body: {start_period, count}
    // 4. Decode SSZ response (array of updates)
    // 5. Return with fork versions
  }

  async getOptimisticUpdate(): Promise<{version: ForkName; data: LightClientOptimisticUpdate}> {
    // 1. Select a peer
    // 2. Send request on protocol: /eth2/beacon_chain/req/light_client_optimistic_update/1/ssz_snappy
    // 3. Empty request body
    // 4. Decode SSZ response
    // 5. Return with fork version
  }

  async getFinalityUpdate(): Promise<{version: ForkName; data: LightClientFinalityUpdate}> {
    // 1. Select a peer
    // 2. Send request on protocol: /eth2/beacon_chain/req/light_client_finality_update/1/ssz_snappy
    // 3. Empty request body
    // 4. Decode SSZ response
    // 5. Return with fork version
  }

  //
  // GOSSIP METHODS (push-based, for staying current)
  //

  onOptimisticUpdate(handler: (optimisticUpdate: LightClientOptimisticUpdate) => void): void {
    this.ensureGossipSubscribed();
    this.eventEmitter.on("optimistic_update", handler);
  }

  onFinalityUpdate(handler: (finalityUpdate: LightClientFinalityUpdate) => void): void {
    this.ensureGossipSubscribed();
    this.eventEmitter.on("finality_update", handler);
  }

  private ensureGossipSubscribed(): void {
    if (this.subscribedToGossip) return;

    // Calculate fork digest for topic names
    const forkDigest = computeForkDigest(...);

    // Subscribe to gossip topics
    const optimisticTopic = `/eth2/${forkDigest}/light_client_optimistic_update/ssz_snappy`;
    const finalityTopic = `/eth2/${forkDigest}/light_client_finality_update/ssz_snappy`;

    this.gossipsub.subscribe(optimisticTopic);
    this.gossipsub.subscribe(finalityTopic);

    // Handle incoming gossip messages
    this.gossipsub.addEventListener("gossipsub:message", (event) => {
      const {topic, data} = event.detail;
      
      if (topic === optimisticTopic) {
        const update = deserializeLightClientOptimisticUpdate(data);
        this.eventEmitter.emit("optimistic_update", update);
      }
      
      if (topic === finalityTopic) {
        const update = deserializeLightClientFinalityUpdate(data);
        this.eventEmitter.emit("finality_update", update);
      }
    });

    this.subscribedToGossip = true;
  }
}
```

---

## Code to Copy from Beacon Node

Look in `packages/beacon-node/src/network/` for:

### 1. libp2p Setup
- `packages/beacon-node/src/network/libp2p/index.ts`
- Connection management, transport config

### 2. discv5 / Peer Discovery
- `packages/beacon-node/src/network/discv5/index.ts`
- `packages/beacon-node/src/network/peers/` - peer management

### 3. GossipSub
- `packages/beacon-node/src/network/gossip/` - gossip handling
- Topic encoding/decoding, message validation

### 4. Req/Resp
- `packages/beacon-node/src/network/reqresp/` - request/response protocols
- Protocol definitions, encoding, handlers

### 5. SSZ Types
- Already available via `@lodestar/types`
- `LightClientBootstrap`, `LightClientUpdate`, `LightClientOptimisticUpdate`, `LightClientFinalityUpdate`

---

## Key Differences from REST Transport

| Aspect | REST Transport | P2P Transport |
|--------|----------------|---------------|
| Dependency | Beacon node REST API | libp2p, discv5, gossipsub |
| Sync requests | HTTP GET | Req/resp protocol over libp2p stream |
| Live updates | SSE subscription | Gossipsub topic subscription |
| Peer selection | Single configured URL | Select from discovered peers |
| Relay duty | None | Must relay gossip to peers |

---

## Usage Example (target API)

```typescript
import {Lightclient} from "@lodestar/light-client";
import {LightClientP2PTransport} from "@lodestar/light-client/transport";
import {getChainForkConfigFromNetwork} from "@lodestar/light-client/utils";

const config = getChainForkConfigFromNetwork("mainnet");

const transport = new LightClientP2PTransport({
  bootnodes: [
    "/ip4/192.168.1.1/tcp/9000/p2p/16Uiu2HAm...",
    "/ip4/192.168.1.2/tcp/9000/p2p/16Uiu2HAm...",
  ],
  networkConfig: config,
});

const lightclient = await Lightclient.initializeFromCheckpointRoot({
  config,
  transport,  // P2P transport instead of REST
  genesisData: {...},
  checkpointRoot: "0x...",
});

await lightclient.start();
```

---

## Testing Strategy

### 1. Unit Tests
- Mock libp2p/gossipsub responses
- Test SSZ encoding/decoding
- Test peer selection logic

### 2. Integration Tests
- Run against local Lodestar beacon node
- Verify req/resp protocols work
- Verify gossip subscription receives updates

### 3. Interop Tests
- Connect to Nimbus beacon nodes
- Ensure cross-client compatibility

---

## Implementation Order

1. **Setup**: Create `p2p.ts` file with class skeleton
2. **libp2p**: Copy and adapt libp2p initialization
3. **discv5**: Copy and adapt peer discovery
4. **Req/resp**: Implement `getBootstrap` first (simplest)
5. **Req/resp**: Implement remaining methods
6. **Gossipsub**: Implement topic subscription
7. **Integration**: Wire up to Lightclient, test end-to-end
8. **Polish**: Error handling, peer management, reconnection logic

---

## Notes

- The light client does NOT respond to req/resp requests, only sends them
- The light client DOES relay gossip messages (this is handled by gossipsub automatically)
- No changes needed to beacon node - it already publishes to these topics and handles these req/resp protocols
- Fork digest in topic names must match the current fork (altair, bellatrix, capella, deneb, electra)
- Context bytes in req/resp responses indicate the fork version for SSZ decoding