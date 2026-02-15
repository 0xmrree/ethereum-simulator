# Discv5 Component Analysis for Light Client P2P

This document provides a detailed analysis of the discv5 (Discovery v5) implementation in the Lodestar beacon node, with focus on understanding how to adapt it for the light client P2P networking layer.

## Table of Contents

1. [What is Discv5?](#what-is-discv5)
2. [Main Structure and Classes](#main-structure-and-classes)
3. [Example Usage from Beacon Node](#example-usage-from-beacon-node)
4. [Dependencies](#dependencies)
5. [Summary: Discv5 in the Beacon Node](#summary-discv5-in-the-beacon-node)
6. [Relevance to Light Client P2P](#relevance-to-light-client-p2p)

---

## What is Discv5?

Discv5 (Discovery v5) is a peer discovery protocol used by Ethereum nodes to find other nodes in the network. It operates over UDP and uses a Kademlia-based distributed hash table (DHT) to store and lookup node records (ENRs - Ethereum Node Records).

Key concepts:
- **ENR (Ethereum Node Record)**: A self-signed record containing a node's network identity, IP address, ports, and Ethereum-specific metadata (fork digest, subnets, etc.)
- **Kademlia DHT**: A distributed hash table for decentralized peer discovery
- **Random node queries**: Periodic searches through the DHT to discover new peers

---

## Main Structure and Classes

The discv5 implementation in Lodestar is located in `packages/beacon-node/src/network/discv5/` and consists of 4 files:

### File Structure

```
packages/beacon-node/src/network/discv5/
├── index.ts     # Discv5Worker - main wrapper class
├── types.ts     # Type definitions (Discv5WorkerApi, Discv5WorkerData, LodestarDiscv5Opts)
├── utils.ts     # ENR relevance filtering (enrRelevance function)
└── worker.ts    # Worker thread implementation
```

### Core Class: `Discv5Worker`

**Location:** `packages/beacon-node/src/network/discv5/index.ts`

The `Discv5Worker` class is the main entry point. It wraps the discv5 protocol in a separate worker thread for performance isolation.

```typescript
export class Discv5Worker extends EventEmitter {
  private readonly subscription: {unsubscribe: () => void};
  private closed = false;

  constructor(opts: Discv5Opts, workerApi: Discv5WorkerApi) { ... }

  // Static factory method - initializes the worker thread
  static async init(opts: Discv5Opts): Promise<Discv5Worker>;

  // Public API
  async enr(): Promise<SignableENR>;                      // Get current node's ENR
  setEnrValue(key: string, value: Uint8Array): Promise<void>;  // Update ENR field
  async kadValues(): Promise<ENR[]>;                      // Get ENRs in Kademlia table
  async findRandomNode(): Promise<ENR[]>;                 // Perform random DHT search
  async close(): Promise<void>;                           // Shutdown discv5

  // Event: emits "discovered" when a relevant peer is found
  on("discovered", (enr: ENR) => void): this;
}
```

### Configuration Types

**Location:** `packages/beacon-node/src/network/discv5/types.ts`

```typescript
// Options passed to Discv5Worker.init()
export type Discv5Opts = {
  privateKey: PrivateKey;          // Node's private key for signing ENRs
  discv5: LodestarDiscv5Opts;      // Discv5-specific options
  logger: LoggerNode;              // Logger instance
  config: BeaconConfig;            // Beacon chain config (fork schedule)
  genesisTime: number;             // Chain genesis time
  metrics?: NetworkCoreMetrics;    // Optional metrics
};

// Discv5-specific options
export type LodestarDiscv5Opts = {
  config?: Discv5Config;           // @chainsafe/discv5 config
  enr: string;                     // Initial ENR as text
  bindAddrs: BindAddrs;            // UDP bind addresses (ip4/ip6)
  bootEnrs: string[];              // Bootstrap node ENRs
};

// Data passed to worker thread
export interface Discv5WorkerData {
  enr: string;
  privateKeyProto: Uint8Array;
  bindAddrs: BindAddrs;
  config: Discv5Config;
  bootEnrs: string[];
  metrics: boolean;
  chainConfig: ChainConfig;        // Needed for fork checking
  genesisValidatorsRoot: Uint8Array;  // Needed for fork digest
  loggerOpts: LoggerNodeOpts;
  genesisTime: number;             // Needed for current slot calculation
}
```

### Worker API

**Location:** `packages/beacon-node/src/network/discv5/types.ts`

The `Discv5WorkerApi` interface defines the methods exposed by the worker thread:

```typescript
export type Discv5WorkerApi = {
  enr(): Promise<SignableENRData>;
  setEnrValue(key: string, value: Uint8Array): Promise<void>;
  kadValues(): Promise<ENRData[]>;
  discoverKadValues(): Promise<void>;
  findRandomNode(): Promise<ENRData[]>;
  discovered(): Observable<ENRData>;  // Stream of discovered ENRs
  scrapeMetrics(): Promise<string>;
  close(): Promise<void>;
};
```

### Worker Implementation

**Location:** `packages/beacon-node/src/network/discv5/worker.ts`

The worker thread:
1. Receives `Discv5WorkerData` from the main thread
2. Creates the `@chainsafe/discv5` instance via `Discv5.create()`
3. Loads bootstrap ENRs
4. Filters discovered peers by fork relevance using `enrRelevance()`
5. Exposes the `Discv5WorkerApi` interface

```typescript
// Key initialization in worker.ts:
const discv5 = Discv5.create({
  enr: SignableENR.decodeTxt(workerData.enr, privateKey.raw),
  privateKey,
  bindAddrs: { ip4: multiaddr(...), ip6: multiaddr(...) },
  config: workerData.config,
  metricsRegistry,
});

// Load boot ENRs
for (const bootEnr of workerData.bootEnrs) {
  discv5.addEnr(bootEnr);
}

// Filter discovered peers
const onDiscovered = (enr: ENR): void => {
  const status = enrRelevance(enr, config, clock);
  if (status === ENRRelevance.relevant) {
    subject.next(enr.toObject());
  }
};
discv5.addListener("discovered", onDiscovered);

await discv5.start();
```

### ENR Relevance Filtering

**Location:** `packages/beacon-node/src/network/discv5/utils.ts`

The `enrRelevance()` function filters discovered ENRs to only include peers on a compatible fork:

```typescript
export enum ENRRelevance {
  no_tcp = "no_tcp",                 // No TCP multiaddr
  no_eth2 = "no_eth2",               // Missing eth2 field
  unknown_forkDigest = "unknown_forkDigest",  // Unknown fork
  current_fork_mismatch = "current_fork_mismatch",  // Wrong fork
  relevant = "relevant",             // Valid peer
}

export function enrRelevance(enr: ENR, config: BeaconConfig, clock: IClock): ENRRelevance {
  // 1. Check for TCP multiaddr (required for connection)
  const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
  if (!multiaddrTCP) return ENRRelevance.no_tcp;

  // 2. Check for eth2 field (required for fork identification)
  const eth2 = enr.kvs.get(ENRKey.eth2);
  if (!eth2) return ENRRelevance.no_eth2;

  // 3. Extract fork digest and verify it's known
  const forkDigest = eth2.slice(0, 4);
  const {fork: forkName} = config.forkDigest2ForkBoundaryOption(forkDigest) ?? {};
  if (forkName === undefined) return ENRRelevance.unknown_forkDigest;

  // 4. Check if fork matches current or previous fork
  const currentSlot = clock.slotWithFutureTolerance(...);
  const localForkInfo = config.getForkInfo(currentSlot);
  if (forkName !== localForkInfo.name && forkName !== localForkInfo.prevForkName) {
    return ENRRelevance.current_fork_mismatch;
  }

  return ENRRelevance.relevant;
}
```

---

## Example Usage from Beacon Node

### 1. Initialization in NetworkCore

**Location:** `packages/beacon-node/src/network/core/networkCore.ts`

```typescript
static async init(modules: NetworkCoreInitModules): Promise<NetworkCore> {
  // ...

  // Discv5 reference for ENR updates
  let discv5: Discv5Worker | undefined;
  const onMetadataSetValue = function(key: string, value: Uint8Array): void {
    discv5?.setEnrValue(key, value).catch((e) => logger.error(...));
  };

  // Create MetadataController with ENR update callback
  const metadataController = new MetadataController(
    {metadata: opts.metadata},
    {networkConfig, logger, onSetValue: onMetadataSetValue}
  );

  // Create PeerManager which creates PeerDiscovery which creates Discv5Worker
  const peerManager = await PeerManager.init(...);

  // Resolve circular reference
  discv5 = peerManager["discovery"]?.discv5;

  return new NetworkCore(...);
}
```

### 2. Discovery in PeerDiscovery

**Location:** `packages/beacon-node/src/network/peers/discover.ts`

```typescript
export class PeerDiscovery {
  readonly discv5: Discv5Worker;

  static async init(modules: PeerDiscoveryModules, opts: PeerDiscoveryOpts): Promise<PeerDiscovery> {
    // Initialize discv5 worker
    const discv5 = await Discv5Worker.init({
      discv5: opts.discv5,
      privateKey: modules.privateKey,
      metrics: modules.metrics ?? undefined,
      logger: modules.logger,
      config: modules.networkConfig.config,
      genesisTime: modules.clock.genesisTime,
    });

    return new PeerDiscovery(modules, opts, discv5);
  }

  constructor(modules, opts, discv5) {
    // Listen for discovered ENRs
    this.discv5.on("discovered", this.onDiscoveredENR);

    // Optionally dial boot ENRs directly
    if (this.connectToDiscv5BootnodesOnStart) {
      for (const bootENR of opts.discv5.bootEnrs) {
        this.onDiscoveredENR(ENR.decodeTxt(bootENR));
      }
    }
  }

  // Called by PeerManager heartbeat to find more peers
  discoverPeers(peersToConnect: number, ...): void {
    // Check cached ENRs first
    // Dial matching peers
    // If not enough, trigger findRandomNode query
    if (shouldRunFindRandomNodeQuery) {
      void this.runFindRandomNodeQuery();
    }
  }

  private async runFindRandomNodeQuery(): Promise<void> {
    const enrs = await this.discv5.findRandomNode();
    // ENRs are emitted via "discovered" event and handled in onDiscoveredENR
  }

  private onDiscoveredENR = async (enr: ENR): Promise<void> => {
    // Extract peer info from ENR
    const peerId = enr.peerId;
    const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
    const attnets = enr.kvs.get(ENRKey.attnets);
    const syncnets = enr.kvs.get(ENRKey.syncnets);

    // Handle the discovered peer (cache or dial)
    this.handleDiscoveredPeer(peerId, multiaddrTCP, attnets, syncnets);
  };
}
```

### 3. ENR Metadata Updates

**Location:** `packages/beacon-node/src/network/metadata.ts`

The `MetadataController` manages the node's ENR metadata and updates discv5 when values change:

```typescript
export class MetadataController {
  private onSetValue: (key: string, value: Uint8Array) => void;  // Calls discv5.setEnrValue

  set attnets(attnets: BitArray) {
    this.onSetValue(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(attnets));
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  set syncnets(syncnets: BitArray) {
    this.onSetValue(ENRKey.syncnets, ssz.altair.SyncSubnets.serialize(syncnets));
    this._metadata.seqNumber++;
    this._metadata.syncnets = syncnets;
  }

  updateEth2Field(epoch: Epoch): phase0.ENRForkID {
    const enrForkId = getENRForkID(config, epoch);
    this.onSetValue(ENRKey.eth2, ssz.phase0.ENRForkID.serialize(enrForkId));
    return enrForkId;
  }
}
```

---

## Dependencies

### External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@chainsafe/discv5` | ^11.0.4 | Core discv5 protocol implementation |
| `@chainsafe/enr` | ^5.0.1 | ENR encoding/decoding |
| `@chainsafe/threads` | ^1.11.3 | Worker thread management |
| `@libp2p/crypto` | - | Key serialization (privateKeyToProtobuf) |
| `@libp2p/peer-id` | - | Peer ID from private key |
| `@multiformats/multiaddr` | - | Multiaddr parsing |

### Internal Dependencies

| Package | Purpose |
|---------|---------|
| `@lodestar/config` | BeaconConfig for fork schedule |
| `@lodestar/logger` | Logging |
| `@lodestar/utils` | Metrics utilities |
| `@lodestar/params` | Fork sequence constants |

### Beacon-Node Specific Dependencies (Would Need Adaptation)

| Module | Usage | Light Client Alternative |
|--------|-------|-------------------------|
| `NetworkCoreMetrics` | Prometheus metrics | Skip or implement lightweight version |
| `Clock` | Current slot calculation | Create from genesis time + config |
| `BeaconConfig` | Fork schedule | Create from checkpoint/bootstrap data |

---

## Summary: Discv5 in the Beacon Node

The discv5 implementation in the Lodestar beacon node serves as the **primary peer discovery mechanism** for the Ethereum consensus layer P2P network. Here is a high-level summary of its role and architecture:

The beacon node runs discv5 in a **separate worker thread** to prevent CPU-intensive DHT operations from blocking the main event loop. The `Discv5Worker` class acts as a facade that abstracts the worker thread communication, providing a clean async API to the rest of the networking stack.

When the beacon node starts, it initializes discv5 with the node's private key, network configuration, and a list of bootstrap ENRs (well-known entry points to the network). The node then publishes its own ENR to the DHT, advertising its IP address, ports, and Ethereum-specific metadata including its current fork digest and subscribed subnets (attnets, syncnets).

Discovery happens through two mechanisms: (1) **automatic periodic queries** performed by the underlying `@chainsafe/discv5` library, and (2) **explicit random node queries** triggered by the `PeerManager` when more peers are needed. All discovered ENRs are filtered through the `enrRelevance()` function to ensure they represent peers on a compatible fork and have reachable TCP addresses.

The filtered ENRs are cached and used by the `PeerDiscovery` class to dial new peers. The discovery process prioritizes peers that subscribe to needed subnets (attestation subnets, sync committee subnets, and in post-Fulu, custody groups for PeerDAS). This subnet-aware discovery ensures the node can fulfill its validator duties by finding peers that can provide the required attestations and sync committee messages.

ENR metadata is kept up-to-date through the `MetadataController`, which updates the discv5 ENR whenever the node's subnet subscriptions change or a fork transition occurs. This ensures other nodes in the network can accurately discover this node based on its current capabilities.

---

## Relevance to Light Client P2P

For the light client P2P implementation, discv5 will serve as the **foundation for peer discovery**, enabling the light client to find peers that can serve light client protocol messages without relying on a centralized beacon node REST API. Here is how discv5 relates to the light client networking goals:

The light client needs discv5 to discover peers that support the light client wire protocol. Unlike a full beacon node which needs peers for all subnet types (attestation, sync committee, custody groups), the light client only needs to find peers that can respond to light client-specific req/resp messages (`LightClientBootstrap`, `LightClientUpdatesByRange`, `LightClientFinalityUpdate`, `LightClientOptimisticUpdate`) and relay the global gossip topics (`light_client_finality_update`, `light_client_optimistic_update`).

The good news is that the core discv5 code is relatively **self-contained** and can be adapted for the light client with minimal changes. The main adaptations needed are:

1. **Simpler Worker Architecture**: The light client can run discv5 on the main thread instead of a worker, since it has fewer concurrent operations and lower performance requirements than a full beacon node.

2. **Bootstrap Data for Configuration**: The beacon node gets `chainConfig`, `genesisValidatorsRoot`, and `genesisTime` from its own chain state. The light client will obtain these from the trusted checkpoint sync or bootstrap response, then use them to create a `BeaconConfig` for fork filtering.

3. **Simplified ENR Metadata**: The light client doesn't need to advertise `attnets`, `syncnets`, or `cgc` (custody group count) since it's not a validator. It only needs the basic `eth2` field for fork identification.

4. **No Subnet-Aware Discovery**: The light client doesn't need to prioritize peers by subnet subscriptions. A simpler discovery strategy that just finds any healthy peers on the correct fork is sufficient.

5. **Shared `@chainsafe/discv5` Dependency**: Both the beacon node and light client can use the same underlying `@chainsafe/discv5` library. The light client just needs a thinner wrapper around it.

The `enrRelevance()` utility function can be reused directly, as the light client has the same need to filter out peers on incompatible forks. The `ENRKey` constants and serialization utilities from `metadata.ts` can also be shared or copied.

In summary, discv5 for the light client is about **finding any peer on the right fork that can serve light client data**, rather than the beacon node's more complex requirement of finding specific peers for specific subnets. The light client can use a simplified version of the beacon node's discv5 wrapper, running on the main thread with minimal ENR metadata and straightforward peer selection.

---

## Key Files Reference

| File | Path | Purpose |
|------|------|---------|
| Discv5Worker | `beacon-node/src/network/discv5/index.ts` | Main wrapper class |
| Types | `beacon-node/src/network/discv5/types.ts` | Type definitions |
| Worker | `beacon-node/src/network/discv5/worker.ts` | Worker thread implementation |
| Utils | `beacon-node/src/network/discv5/utils.ts` | ENR relevance filtering |
| PeerDiscovery | `beacon-node/src/network/peers/discover.ts` | Discovery orchestration |
| MetadataController | `beacon-node/src/network/metadata.ts` | ENR metadata management |
| NetworkCore | `beacon-node/src/network/core/networkCore.ts` | Network initialization |
