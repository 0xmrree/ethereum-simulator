# Discv5: Ethereum's P2P Node Discovery Protocol

## TL;DR

Discv5 is a **P2P ENR search engine**. You give it criteria (topic, protocol), it finds nodes in the network that match, and hands you back ENRs. That's all it does. Everything else—connecting, gossiping, requesting data—is handled by libp2p.

## History

Ethereum launched in 2015 before libp2p was mature. The team built discv4 for peer discovery, then evolved it to discv5 for Ethereum 2.0 (the beacon chain). By the time better options like libp2p's built-in DHT existed, Ethereum already had a working solution with extensive tooling around it.

## Why Ethereum Has Its Own Discovery Protocol

Other P2P networks use libp2p's discovery mechanisms just fine, so why does Ethereum maintain its own?

**ENR Format:** Ethereum wanted a specific way to describe nodes. ENRs (Ethereum Node Records) contain Ethereum-specific information:
- Fork version (which hard fork are you on?)
- Attestation subnet subscriptions
- Sync committee subscriptions
- Client version

**UDP-Only and Lightweight:** Discv5 runs entirely over UDP, completely decoupled from data transport. Libp2p's built-in DHT runs over the same TCP/QUIC connections as your actual data. Ethereum wanted discovery separate—you can discover nodes without ever opening a heavy connection to them.

**Historical Momentum:** They built their own early on and kept evolving it. Software is messy.

## The Problem Discv5 Solves

How do you find peers in a decentralized network?

**Without a discovery protocol, your options are bad:**

- **Central server** — Single point of failure and censorship. Server goes down, network dies.
- **Hardcoded peers** — What if those peers go offline or get blocked?
- **Broadcast to everyone** — Doesn't scale. Millions of nodes all broadcasting is chaos.

**What discv5 provides:**

A decentralized way to find peers. No single node has a complete directory, but collectively the network can route you to whoever you're looking for. The underlying DHT (based on Kademlia) provides logarithmic lookup times—in a network of 10,000 nodes, you find any node in roughly 13-14 hops.

## What Discv5 Does (and Doesn't Do)

**What discv5 does:**
- Bootstrap a new node into the network from just one or two bootnodes
- Discover peers that support protocols/topics you care about
- Maintain a table of known peers (ENRs) so you always have nodes to connect to
- Keep track of nodes' current IP, port, and capabilities

**What discv5 does NOT do:**
- Gossip blocks or attestations
- Handle req/resp messages
- Any actual data exchange

It's purely the discovery layer. Once discv5 finds you peers, it hands off to libp2p for actual communication.

## Key Concepts

### ENR (Ethereum Node Record)

An ENR contains everything you need to connect to a node:

```typescript
interface ENR {
  nodeId: string;         // keccak256 hash of public key
  ip: string;             // Where to connect
  port: number;
  publicKey: string;      // For establishing encrypted connection
  capabilities: string[]; // What protocols/topics this node supports
}
```

### Node ID vs Account Address

These are completely different things using different key pairs:

| Type | Key Curve | Size | Purpose |
|------|-----------|------|---------|
| Node ID | secp256k1 | 256 bits (full keccak256 hash) | P2P network identity |
| Account Address | secp256k1 | 160 bits (last 20 bytes of hash) | Hold ETH, sign transactions |
| Validator Key | BLS12-381 | — | Sign attestations, propose blocks |

A beacon node's P2P identity has nothing to do with any Ethereum wallet or validator keys.

### Known vs Connected Peers

Important distinction:

- **Known** — You have their ENR in your peer table. You *could* connect if you wanted.
- **Connected** — You have an active libp2p connection and are exchanging gossip/req/resp.

Discv5 manages the "known" pool. The peer manager decides which of those known peers to actually open connections to.

## Topics vs Protocols

When discv5 finds peers, it's looking for peers that support specific **topics** or **protocols**. These are different things:

### Topics = Gossip (Pub/Sub, Push-Based)

A topic is a channel that nodes subscribe to. When anyone publishes a message to that topic, all subscribers receive it. It's broadcast-based.

```typescript
// Gossip topics - you subscribe and receive broadcasts
const topics = [
  "beacon_block",                      // New blocks get broadcast here
  "beacon_attestation",                // Attestations get broadcast here
  "light_client_finality_update",      // Finality updates broadcast here
  "light_client_optimistic_update"     // Optimistic updates broadcast here
];

// You subscribe
gossip.subscribe("light_client_finality_update");

// Now whenever ANY peer publishes to this topic, you receive it
gossip.on("light_client_finality_update", (update) => {
  console.log("Got finality update!", update);
});
```

### Protocols = Req/Resp (Request/Response, Pull-Based)

A protocol is a specific request type you can make to a peer. You ask one peer directly, they respond.

```typescript
// Req/resp protocols - you ask a specific peer for specific data
const protocols = [
  "GetLightClientBootstrap",      // "Give me bootstrap data for this block root"
  "LightClientUpdatesByRange",    // "Give me updates from slot X to Y"
  "BeaconBlocksByRange",          // "Give me blocks from slot X to Y"
  "GetLightClientFinalityUpdate"  // "Give me the latest finality update"
];

// You request from a specific peer
const bootstrap = await reqResp.request(peer, "GetLightClientBootstrap", {
  blockRoot: "0xabc..."
});
```

### Summary

| | Topic (Gossip) | Protocol (Req/Resp) |
|---|---|---|
| Direction | Broadcast to all subscribers | Request to one peer |
| Model | Push | Pull |
| Use case | Real-time updates | Fetching specific data |
| Example | "Hey everyone, here's a new block" | "Hey peer, give me blocks 100-200" |

## Discv5 Interface

```typescript
class Discv5 {
  // Internal state - peers you know about (organized in k-buckets)
  private peerTable: Map<NodeId, ENR>;

  constructor(bootnodes: ENR[]) {
    // Start with just bootnodes
    // Protocol runs in background, discovering more peers
    // peerTable grows over time as you learn about the network
  }

  // Find peers that advertise a specific topic
  // Used to find peers for gossip topics like "beacon_block",
  // "light_client_finality_update", etc.
  findPeersForTopic(topic: string): ENR[];

  // Find peers that support a specific req/resp protocol
  // Used to find peers that can handle "GetLightClientBootstrap",
  // "LightClientUpdatesByRange", etc.
  findPeersForProtocol(protocolId: string): ENR[];

  // Maintain awareness of the network
  refreshPeerPool(): ENR[];
}
```

## How Discv5 Fits in the Networking Stack

Discv5 doesn't work alone. There's a layered architecture:

```
┌─────────────────────────────────────────────────────────┐
│                   Gossip / ReqResp                      │
│            (actual data exchange over TCP/QUIC)         │
└─────────────────────────┬───────────────────────────────┘
                          │ "here are connected peers"
┌─────────────────────────┴───────────────────────────────┐
│                    Peer Manager                         │
│         (decides who to connect to, peer scoring)       │
└─────────────────────────┬───────────────────────────────┘
                          │ "open connection to this ENR"
┌─────────────────────────┴───────────────────────────────┐
│                       Libp2p                            │
│        (handles TCP/QUIC connections, encryption)       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                       Discv5                            │
│              (UDP-based peer discovery)                 │
│                "here are known ENRs"                    │
└─────────────────────────────────────────────────────────┘
```

**Key insight:** Gossip and req/resp don't directly call discv5. They work with already-connected libp2p peers. The peer manager is the bridge.

## Peer Manager Example

```typescript
class PeerManager {
  private discv5: Discv5;
  private libp2p: Libp2p;  // Handles actual TCP/QUIC connections
  private connectedPeers: Map<NodeId, Connection>;

  async ensureTopicCoverage(topic: string, minPeers: number) {
    const connectedForTopic = this.getConnectedPeersForTopic(topic);
    
    if (connectedForTopic.length < minPeers) {
      // Ask discv5 for more peers that support this topic
      const discovered: ENR[] = await this.discv5.findPeersForTopic(topic);
      
      for (const enr of discovered) {
        if (!this.connectedPeers.has(enr.nodeId)) {
          // libp2p handles the actual connection
          const connection = await this.libp2p.dial(enr);
          this.connectedPeers.set(enr.nodeId, connection);
        }
      }
    }
  }

  async ensureProtocolCoverage(protocolId: string, minPeers: number) {
    // Same pattern for req/resp protocols
  }
}
```

## Transport Protocols

| Protocol | Transport | Used For |
|----------|-----------|----------|
| Discv5 | UDP | Lightweight discovery pings/queries |
| Libp2p (gossip, req/resp) | TCP or QUIC | Reliable, persistent connections for data |

**Why UDP for discovery?**

Discovery is lightweight—small queries, quick responses. No need for the overhead of TCP connection establishment. You might ping hundreds of nodes during discovery; UDP keeps this fast and cheap.

**Why TCP/QUIC for data?**

Gossip and req/resp need reliability. You can't have blocks or attestations getting lost. TCP/QUIC provide guaranteed delivery and ordering.

## Light Client Context

For a light client implementing P2P networking, discv5 is used to discover peers that:

**Support req/resp protocols:**
- GetLightClientBootstrap
- LightClientUpdatesByRange
- GetLightClientFinalityUpdate
- GetLightClientOptimisticUpdate

**Subscribe to gossip topics:**
- `light_client_finality_update`
- `light_client_optimistic_update`

The light client uses discv5 to find these peers, connects via libp2p, then uses gossip and req/resp to actually sync and stay updated—all without relying on a centralized REST API that could be censored.