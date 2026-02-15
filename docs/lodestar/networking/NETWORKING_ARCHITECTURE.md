# Light Client Networking Architecture

This document describes the networking components a light client needs for P2P support, based on Lodestar's beacon node architecture simplified for `useWorker: false` (single-threaded).

## Component Overview

Everything runs on a single event loop. No worker threads, no cross-thread bridges.

```
LightClient (main thread)
  │
  ├── NetworkCore
  │   ├── libp2p              [TRANSPORT - TCP connections, streams]
  │   ├── Eth2Gossipsub       [GOSSIP - finality + optimistic updates]
  │   ├── ReqResp             [REQRESP - bootstrap, updates by range]
  │   ├── PeerManager         [PEERS - heartbeat, scoring, connect/disconnect]
  │   │   └── PeerDiscovery
  │   │       └── Discv5      [DISCOVERY - find peers via DHT]
  │   ├── MetadataController  [ENR - our node's identity metadata]
  │   └── PeersData           [STORE - in-memory peer info]
  │
  └── NetworkEventBus         [EVENTS - peer connect, gossip messages]
```

## Components

### libp2p

The transport layer. Manages TCP connections, multiplexed streams, and the Noise handshake. Identity comes from a private key → PeerId. Created once at startup, never changes.

**Source**: `packages/beacon-node/src/network/libp2p/index.ts`

### ReqResp

Request/response protocol for fetching data from peers. The light client is **requester only** — it asks peers for data but doesn't serve it.

**Methods the light client needs**:
- `LightClientBootstrap` (V1) — single response, one bootstrap object
- `LightClientUpdatesByRange` (V1) — multi response, one update per sync committee period
- `LightClientFinalityUpdate` (V1) — single response
- `LightClientOptimisticUpdate` (V1) — single response
- `Status` (V1) — exchanged on peer connect
- `Ping` (V1) — keepalive
- `Metadata` (V2) — exchange node metadata
- `Goodbye` (V1) — clean disconnect

All light client methods use V1 with `ForkDigest` context bytes. The fork digest (4 bytes in each response chunk) tells the receiver which SSZ schema to use for deserialization, since types like `LightClientUpdate` have different fields across forks (e.g. Altair vs Capella added execution payload header).

**Two sides**:
- **Handlers** (responder): `async function*` generators that yield `ResponseOutgoing` — the light client won't need these since it only requests, not serves
- **Collectors** (requester): consume `AsyncIterable<ResponseIncoming>` and deserialize each chunk — this is what the light client uses

**Source**: `packages/reqresp/src/ReqResp.ts`, `packages/beacon-node/src/network/reqresp/`

### Eth2Gossipsub

Pub/sub for real-time updates. The light client subscribes to two topics:
- `light_client_finality_update` — new finality updates
- `light_client_optimistic_update` — new optimistic updates

Beacon node gossipsub is complex (64 attestation subnets, scoring params, etc). Light client can use much simpler config.

**Source**: `packages/beacon-node/src/network/gossip/gossipsub.ts`

### PeerManager

Runs a heartbeat every ~30 seconds:
- Pings peers to check liveness
- Exchanges Status to verify peers are on the same chain
- Triggers discovery when below target peer count
- Disconnects low-scoring or excess peers

Light client needs fewer peers (10-30 vs 200 for beacon node) and simpler scoring (no subnet logic, no custody groups).

**Source**: `packages/beacon-node/src/network/peers/peerManager.ts`

### PeerDiscovery + Discv5

Finds peers via the discv5 protocol (Kademlia DHT over UDP). Bootstraps from known ENR records, then discovers more peers over time. Filters discovered peers by fork digest and basic relevance checks before dialing.

Light client simplification: no subnet-targeted queries, just find peers on the right fork.

**Source**: `packages/beacon-node/src/network/peers/discover.ts`, `packages/beacon-node/src/network/discv5/`

### MetadataController

Manages our node's ENR (Ethereum Node Record) — the metadata that tells other peers who we are. Contains fork version, subnet subscriptions, and a sequence number that increments on updates.

Light client ENR is simpler: no attnets, no syncnets, no custody group count.

**Source**: `packages/beacon-node/src/network/metadata.ts`

### NetworkEventBus

Type-safe event emitter connecting components. Key events:
- `peerConnected` / `peerDisconnected`
- `pendingGossipsubMessage` (incoming gossip)
- `reqRespRequest` (incoming req/resp)

In single-threaded mode these are direct function calls within the same event loop — no serialization overhead.

**Source**: `packages/beacon-node/src/network/events.ts`

## Initialization Flow

```
LightClient.init()
  │
  ├── Generate or load private key
  │
  ├── createNodeJsLibp2p(privateKey, ...)
  │   └── privateKey → PeerId, TCP transport, Noise, connection limits
  │
  ├── Create Eth2Gossipsub (simplified config)
  ├── Start Gossipsub
  │
  ├── Create ReqResp
  ├── Start ReqResp
  ├── Register protocols at current fork boundary
  │
  ├── PeerManager.init()
  │   └── PeerDiscovery.init()
  │       └── Discv5.init(bootEnrs)
  │
  ├── Set ENR metadata (fork version)
  │
  └── Ready — start sync
```

## What We Keep vs Drop from Beacon Node

| Beacon Node Component | Light Client | Why |
|----------------------|-------------|-----|
| libp2p | Keep | Same transport layer |
| ReqResp | Keep (requester only) | Need to fetch LC data from peers |
| Eth2Gossipsub | Keep (simplified) | 2 topics instead of 80+ |
| PeerManager | Keep (simplified) | Fewer peers, simpler scoring |
| Discv5 | Keep | Same discovery mechanism |
| MetadataController | Keep (simplified) | Simpler ENR, no subnets |
| Network facade | Simplify | No multiplexer needed, single thread |
| WorkerNetworkCore | Drop | No worker threads |
| AsyncIterableBridge | Drop | Not needed without workers |
| NetworkProcessor | Drop | No gossip validation queues |
| AttnetsService | Drop | No attestation subnets |
| SyncnetsService | Drop | No sync committee subnets |
| AggregatorTracker | Drop | No validator duties |
| Custody groups | Drop | No PeerDAS |

## Key Simplifications

1. **Single-threaded**: No worker, no bridge, no message serialization. ReqResp uses native async generators with `yield*` for streaming.

2. **Requester only for ReqResp**: Light client asks peers for data but doesn't serve handlers. No need for `getReqRespHandlers()`.

3. **Minimal gossip**: Subscribe to 2 topics, accept messages, pass to light client sync logic. No complex validation queues.

4. **Simple peer scoring**: Score peers based on whether they respond to LC requests successfully. No gossipsub scoring params, no subnet tracking.

5. **Fork handling**: On fork transitions, re-register ReqResp protocols and update ENR. SSZ types change per fork — the fork digest in each response chunk tells us which schema to use.
