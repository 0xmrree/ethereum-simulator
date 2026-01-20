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

## Why P2P? Why libp2p/gossipsub?

### The Problem with REST

With REST, the light client connects to a single beacon node. This creates:

1. **Single point of failure** - If that node goes down, you're blind
2. **Censorship vulnerability** - That node can filter what it sends you
3. **Centralization pressure** - Public REST APIs are rate-limited and often run by companies (Infura, Alchemy) who could censor or charge for access

### Why Not Just Discover Peers and Use REST?

You might think: "Run discv5 to find peers, then subscribe to each peer's REST SSE endpoint." 

This doesn't work because most beacon nodes don't expose their REST API publicly. REST is opt-in, firewalled, and meant for local/trusted access. P2P gossipsub is how beacon nodes actually talk to each other—it's always on.

### Publisher Asymmetry - The Core Problem P2P Solves

Imagine Ethereum tried to broadcast using REST:

```
Block proposer creates block
    │
    ├── POST to Node A
    ├── POST to Node B
    ├── POST to Node C
    ├── ... 
    └── POST to Node 10,000

Publisher does O(n) work
Everyone else does O(1) work
```

The proposer would be crushed. They'd never propagate a block to 10,000 nodes in the ~4 seconds before attesters need to vote.

Gossipsub solves this with distributed cost:

```
Block proposer creates block
    │
    └── Send to 8 mesh peers ── they each forward to 8 peers ── ...
    
Publisher does O(8) work
Everyone does O(8) work
Network as a whole achieves broadcast
```

By distributing the broadcast cost evenly across all participants, no single node becomes a bottleneck. This is why P2P gossip exists—not just for Ethereum, but BitTorrent, Bitcoin, and any system where "one thing, many recipients" needs to scale.

### What libp2p Provides

libp2p is the networking stack that handles:

- **Transport**: TCP, QUIC, WebSocket connections
- **Multiplexing**: Multiple logical streams over one connection  
- **Encryption**: Noise protocol for secure channels
- **Peer identity**: Cryptographic peer IDs
- **Protocol negotiation**: Peers agree on protocols to speak

On top of libp2p:

- **discv5**: Peer discovery (find nodes on the network)
- **gossipsub**: Pub/sub protocol (efficient broadcast via mesh)
- **req/resp**: Request/response protocols (direct peer queries)

The light client needs all of this to become a real participant in the Ethereum network rather than a second-class citizen hanging off a single REST endpoint.

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

## In Joe's words:
 Now let me get a crack at putting everything together. The current transport for light client directly hits the light client api rest endpoint to get up to date then it subscribes to events topic on the rest api whihc is a rest http way to subscribe to a topic. Ok great but we can be sensored by our single beacon node were connected to. And to make matters worse the node we connecte to would typically be a company that his making the beacon api publically asseable and not do a strict rate limiting whihc increase the chance people censor or start doing some form of subcrtiption. 

Ok now the goal of our tasks to to elevate the light client to be a peer in the ehtuerm p2p netowrk with differnt configation from beacon nodes such that we have dramaticaly reduced are chances of being censored even its jsut from nodes being down with above apporach. 

1. When light clients start up they will run discv5/libp2p with one or more bootnodes to to get a set of peers. It then send req-resp messages to get up to date with a current finalized header and latest sync committe header with > 2/3 votes from the randomly selected committe. 

2. Then it will enter the gossip phase where it tells its peers it wants to subscribe to two topics: light_client_optimistic_update, and light_client_finalized_update. Given this is a p2p network when you are part of the netowrk there is a "cost" in that yes you will get messages for your subscribed topics in a way were you cahnce of being censored drops dramaticaly but you must alsy praticiapte in gossiping these updates to other clients inclkudiung other light clients as well. 
