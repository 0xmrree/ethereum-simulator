# How Discv5 is Used in the Beacon Node

This document provides a practical guide to understanding how discv5 is initialized, configured, and used throughout the beacon node codebase. Use this as a reference when adapting discv5 for the light client.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Initialization Flow](#initialization-flow)
3. [Key Files and Their Roles](#key-files-and-their-roles)
4. [Dependencies](#dependencies)
5. [Code Examples](#code-examples)
6. [Configuration Options](#configuration-options)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BeaconNode                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                           NetworkCore                                │    │
│  │  ┌─────────────────────────────────────────────────────────────┐    │    │
│  │  │                        PeerManager                           │    │    │
│  │  │  ┌─────────────────────────────────────────────────────┐    │    │    │
│  │  │  │                    PeerDiscovery                     │    │    │    │
│  │  │  │  ┌─────────────────────────────────────────────┐    │    │    │    │
│  │  │  │  │               Discv5Worker                   │    │    │    │    │
│  │  │  │  │                    │                         │    │    │    │    │
│  │  │  │  │         ┌─────────┴─────────┐               │    │    │    │    │
│  │  │  │  │         │   Worker Thread   │               │    │    │    │    │
│  │  │  │  │         │  @chainsafe/discv5│               │    │    │    │    │
│  │  │  │  │         └───────────────────┘               │    │    │    │    │
│  │  │  │  └─────────────────────────────────────────────┘    │    │    │    │
│  │  │  └─────────────────────────────────────────────────────┘    │    │    │
│  │  └─────────────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Initialization Flow

### Step 1: CLI Parses Network Arguments

**File:** `packages/cli/src/options/beaconNodeOptions/network.ts`

```typescript
// Lines 77-160
export function parseArgs(args: NetworkArgs): IBeaconNodeOptions["network"] {
  const {listenAddress, port, discoveryPort, ...} = parseListenArgs(args);

  // Set discv5 opts to null to disable only if explicitly disabled
  const enableDiscv5 = args.discv5 ?? true;

  const bootEnrs = args.bootnodes ?? [];

  return {
    discv5: enableDiscv5
      ? {
          config: {},
          bindAddrs: {
            ip4: bindMu as string,  // e.g., "/ip4/0.0.0.0/udp/9000"
            ip6: bindMu6,
          },
          bootEnrs,
          enr: undefined as any,  // Filled in later by initPrivateKeyAndEnr
        }
      : null,
    // ... other options
  };
}
```

### Step 2: Create Private Key and ENR

**File:** `packages/cli/src/cmds/beacon/initPeerIdAndEnr.ts`

```typescript
// Lines 137-199
export async function initPrivateKeyAndEnr(
  args: BeaconArgs,
  beaconDir: string,
  logger: Logger,
  bootnode?: boolean
): Promise<{privateKey: PrivateKey; enr: SignableENR}> {
  const {persistNetworkIdentity} = args;

  const newPrivateKeyAndENR = async (): Promise<{privateKey: PrivateKey; enr: SignableENR}> => {
    // Generate a new secp256k1 key pair
    const privateKey = await generateKeyPair("secp256k1");
    // Create ENR from private key
    const enr = SignableENR.createFromPrivateKey(privateKey);
    return {privateKey, enr};
  };

  // Either create new or read from persisted files
  if (persistNetworkIdentity) {
    const enrFile = path.join(beaconDir, "enr");
    const peerIdFile = path.join(beaconDir, "peer-id.json");
    const {privateKey, enr, newEnr} = await readPersistedPrivateKeyAndENR(peerIdFile, enrFile);
    overwriteEnrWithCliArgs(enr, args, logger, {newEnr, bootnode});
    // Persist for next startup
    writeFile600Perm(peerIdFile, exportToJSON(privateKey));
    writeFile600Perm(enrFile, enr.encodeTxt());
    return {privateKey, enr};
  }

  const {privateKey, enr} = await newPrivateKeyAndENR();
  overwriteEnrWithCliArgs(enr, args, logger, {newEnr: true, bootnode});
  return {privateKey, enr};
}
```

### Step 3: NetworkCore Initialization

**File:** `packages/beacon-node/src/network/core/networkCore.ts`

```typescript
// Lines 132-271
static async init({
  opts,
  config,
  privateKey,
  ...
}: BaseNetworkInit): Promise<NetworkCore> {

  // Create libp2p instance first
  const libp2p = await createNodeJsLibp2p(privateKey, opts, {...});

  // Set up circular dependency for ENR updates
  // discv5 reference is resolved AFTER PeerManager is created
  let discv5: Discv5Worker | undefined;
  const onMetadataSetValue = function onMetadataSetValue(key: string, value: Uint8Array): void {
    discv5?.setEnrValue(key, value).catch((e) => logger.error("error on setEnrValue", {key}, e));
  };

  // Create MetadataController with the ENR update callback
  const metadata = new MetadataController({}, {networkConfig, logger, onSetValue: onMetadataSetValue});

  // Create PeerManager which creates PeerDiscovery which creates Discv5Worker
  const peerManager = await PeerManager.init({...}, opts);

  // Resolve the circular dependency - get discv5 reference from PeerManager
  discv5 = peerManager["discovery"]?.discv5;

  // Initialize ENR with current fork info
  metadata.upstreamValues(clock.currentEpoch);

  return new NetworkCore({...});
}
```

### Step 4: PeerManager Creates PeerDiscovery

**File:** `packages/beacon-node/src/network/peers/peerManager.ts`

```typescript
// Lines 211-222
static async init(modules: PeerManagerModules, opts: PeerManagerOpts): Promise<PeerManager> {
  // opts.discv5 === null means discovery is disabled
  const discovery = opts.discv5
    ? await PeerDiscovery.init(modules, {
        discv5FirstQueryDelayMs: opts.discv5FirstQueryDelayMs ?? DEFAULT_DISCV5_FIRST_QUERY_DELAY_MS,
        discv5: opts.discv5,
        connectToDiscv5Bootnodes: opts.connectToDiscv5Bootnodes,
      })
    : null;

  return new PeerManager(modules, opts, discovery);
}
```

### Step 5: PeerDiscovery Creates Discv5Worker

**File:** `packages/beacon-node/src/network/peers/discover.ts`

```typescript
// Lines 185-196
static async init(modules: PeerDiscoveryModules, opts: PeerDiscoveryOpts): Promise<PeerDiscovery> {
  const discv5 = await Discv5Worker.init({
    discv5: opts.discv5,
    privateKey: modules.privateKey,
    metrics: modules.metrics ?? undefined,
    logger: modules.logger,
    config: modules.networkConfig.config,    // BeaconConfig for fork schedule
    genesisTime: modules.clock.genesisTime,  // For current slot calculation
  });

  return new PeerDiscovery(modules, opts, discv5);
}
```

### Step 6: Discv5Worker Spawns Worker Thread

**File:** `packages/beacon-node/src/network/discv5/index.ts`

```typescript
// Lines 41-66
static async init(opts: Discv5Opts): Promise<Discv5Worker> {
  // Prepare data to pass to worker thread
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
    genesisTime: opts.genesisTime,
  };

  // Spawn worker thread
  const worker = new Worker("./worker.js", {
    suppressTranspileTS: Boolean(globalThis.Bun),
    workerData,
  } as ConstructorParameters<typeof Worker>[1]);

  // Create RPC proxy to worker
  const workerApi = await spawn<Discv5WorkerApi>(worker, {
    timeout: 5 * 60 * 1000,  // 5 minutes - startup can be slow
  });

  return new Discv5Worker(opts, workerApi);
}
```

### Step 7: Worker Thread Initializes @chainsafe/discv5

**File:** `packages/beacon-node/src/network/discv5/worker.ts`

```typescript
// Lines 23-84
// Receive workerData from main thread
const workerData = worker.workerData as Discv5WorkerData;

// Reconstruct private key from protobuf
const privateKey = privateKeyFromProtobuf(workerData.privateKeyProto);

// Create BeaconConfig for fork checking
const config = createBeaconConfig(workerData.chainConfig, workerData.genesisValidatorsRoot);

// Initialize the actual discv5 instance from @chainsafe/discv5
const discv5 = Discv5.create({
  enr: SignableENR.decodeTxt(workerData.enr, privateKey.raw),
  privateKey,
  bindAddrs: {
    ip4: workerData.bindAddrs.ip4 ? multiaddr(workerData.bindAddrs.ip4) : undefined,
    ip6: workerData.bindAddrs.ip6 ? multiaddr(workerData.bindAddrs.ip6) : undefined,
  },
  config: workerData.config,
  metricsRegistry,
});

// Load bootstrap ENRs
for (const bootEnr of workerData.bootEnrs) {
  discv5.addEnr(bootEnr);
}

// Create clock for fork relevance checking
const clock = new Clock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

// Set up ENR filtering - only emit relevant peers
const onDiscovered = (enr: ENR): void => {
  const status = enrRelevance(enr, config, clock);
  if (status === ENRRelevance.relevant) {
    subject.next(enr.toObject());
  }
};
discv5.addListener("discovered", onDiscovered);

// Start discv5 - begins accepting UDP requests
await discv5.start();

// Expose API to main thread
expose(module);
```

---

## Key Files and Their Roles

| File                    | Path                                                    | Role                                                   |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| **Discv5Worker**        | `packages/beacon-node/src/network/discv5/index.ts`      | Main wrapper class - spawns worker, provides async API |
| **Types**               | `packages/beacon-node/src/network/discv5/types.ts`      | Type definitions for worker API and data               |
| **Worker**              | `packages/beacon-node/src/network/discv5/worker.ts`     | Worker thread - runs @chainsafe/discv5                 |
| **Utils**               | `packages/beacon-node/src/network/discv5/utils.ts`      | ENR relevance filtering                                |
| **PeerDiscovery**       | `packages/beacon-node/src/network/peers/discover.ts`    | Orchestrates peer discovery using discv5               |
| **PeerManager**         | `packages/beacon-node/src/network/peers/peerManager.ts` | Manages peer lifecycle, triggers discovery             |
| **NetworkCore**         | `packages/beacon-node/src/network/core/networkCore.ts`  | Network initialization, wires up components            |
| **MetadataController**  | `packages/beacon-node/src/network/metadata.ts`          | Manages ENR metadata (eth2, attnets, syncnets)         |
| **CLI Network Options** | `packages/cli/src/options/beaconNodeOptions/network.ts` | CLI argument parsing for network/discv5                |
| **initPeerIdAndEnr**    | `packages/cli/src/cmds/beacon/initPeerIdAndEnr.ts`      | Creates/loads private key and ENR                      |

---

## Dependencies

### External NPM Packages

```json
{
  "@chainsafe/discv5": "^11.0.4", // Core discv5 protocol
  "@chainsafe/enr": "^5.0.1", // ENR encoding/decoding
  "@chainsafe/threads": "^1.11.3", // Worker thread management
  "@libp2p/crypto": "*", // Key serialization
  "@libp2p/peer-id": "*", // Peer ID from private key
  "@multiformats/multiaddr": "*" // Multiaddr parsing
}
```

### Internal Lodestar Packages

```json
{
  "@lodestar/config": "*", // BeaconConfig, ChainConfig
  "@lodestar/logger": "*", // Logger
  "@lodestar/utils": "*", // Utilities, Gauge for metrics
  "@lodestar/params": "*" // ForkSeq constants
}
```

### Beacon-Node Internal Modules

| Module               | Usage                                       |
| -------------------- | ------------------------------------------- |
| `Clock`              | Current slot calculation for fork relevance |
| `BeaconConfig`       | Fork schedule for ENR filtering             |
| `NetworkCoreMetrics` | Prometheus metrics (optional)               |
| `MetadataController` | ENR field updates (eth2, attnets, syncnets) |

---

## Code Examples

### Example 1: Triggering Peer Discovery

**File:** `packages/beacon-node/src/network/peers/peerManager.ts`

The PeerManager heartbeat runs every 30 seconds and triggers discovery when needed:

```typescript
// Lines 526-633 (heartbeat method)
private heartbeat(): void {
  const connectedPeers = this.getConnectedPeerIds();

  // Decay peer scores
  this.peerRpcScores.update();

  // Disconnect bad peers, collect healthy ones
  const connectedHealthyPeers: PeerId[] = [];
  for (const peer of connectedPeers) {
    switch (this.peerRpcScores.getScoreState(peer)) {
      case ScoreState.Banned:
        void this.goodbyeAndDisconnect(peer, GoodByeReasonCode.BANNED);
        break;
      case ScoreState.Healthy:
        connectedHealthyPeers.push(peer);
    }
  }

  // Calculate how many peers to connect/disconnect
  const {peersToDisconnect, peersToConnect, attnetQueries, syncnetQueries, custodyGroupQueries} =
    prioritizePeers(connectedHealthyPeers.map(...), ...);

  // Trigger discovery if we have discovery enabled
  if (this.discovery) {
    this.discovery.discoverPeers(peersToConnect, custodyGroupQueries, queriesMerged);
  }
}
```

### Example 2: Running a Discovery Query

**File:** `packages/beacon-node/src/network/peers/discover.ts`

```typescript
// Lines 332-361
private async runFindRandomNodeQuery(): Promise<void> {
  // Delay first query after discv5 start
  const msSinceDiscv5Start = Date.now() - this.discv5StartMs;
  if (msSinceDiscv5Start <= this.discv5FirstQueryDelayMs) {
    await sleep(this.discv5FirstQueryDelayMs - msSinceDiscv5Start);
  }

  // Don't run concurrent queries
  if (this.randomNodeQuery.code === QueryStatusCode.Active) {
    return;
  }

  this.randomNodeQuery = {code: QueryStatusCode.Active, count: 0};
  const timer = this.metrics?.discovery.findNodeQueryTime.startTimer();

  try {
    // This calls discv5.findRandomNode() in the worker thread
    const enrs = await this.discv5.findRandomNode();
    this.metrics?.discovery.findNodeQueryEnrCount.inc(enrs.length);
  } catch (e) {
    this.logger.error("Error on discv5.findNode()", {}, e as Error);
  } finally {
    this.randomNodeQuery = {code: QueryStatusCode.NotActive};
    timer?.();
  }
}
```

### Example 3: Handling Discovered ENRs

**File:** `packages/beacon-node/src/network/peers/discover.ts`

```typescript
// Lines 386-424
private onDiscoveredENR = async (enr: ENR): Promise<void> => {
  const peerId = enr.peerId;

  // Get TCP multiaddr (required for connection)
  const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
  if (!multiaddrTCP) {
    this.metrics?.discovery.discoveredStatus.inc({status: DiscoveredPeerStatus.no_multiaddrs});
    return;
  }

  // Extract subnet info from ENR
  const attnetsBytes = enr.kvs.get(ENRKey.attnets);
  const syncnetsBytes = enr.kvs.get(ENRKey.syncnets);
  const custodyGroupCountBytes = enr.kvs.get(ENRKey.cgc);

  const attnets = attnetsBytes ? deserializeEnrSubnets(attnetsBytes, ATTESTATION_SUBNET_COUNT) : zeroAttnets;
  const syncnets = syncnetsBytes ? deserializeEnrSubnets(syncnetsBytes, SYNC_COMMITTEE_SUBNET_COUNT) : zeroSyncnets;
  const custodyGroupCount = custodyGroupCountBytes ? bytesToInt(custodyGroupCountBytes, "be") : undefined;

  // Process the peer (cache or dial)
  const status = this.handleDiscoveredPeer(peerId, multiaddrTCP, attnets, syncnets, custodyGroupCount);
  this.metrics?.discovery.discoveredStatus.inc({status});
};
```

### Example 4: Updating ENR Metadata

**File:** `packages/beacon-node/src/network/metadata.ts`

When subnet subscriptions change, the MetadataController updates the ENR:

```typescript
// Lines 82-96
set attnets(attnets: BitArray) {
  // Callback to discv5.setEnrValue()
  this.onSetValue(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(attnets));
  this._metadata.seqNumber++;
  this._metadata.attnets = attnets;
}

// Lines 129-148
updateEth2Field(epoch: Epoch): phase0.ENRForkID {
  const enrForkId = getENRForkID(config, epoch);
  // Callback to discv5.setEnrValue()
  this.onSetValue(ENRKey.eth2, ssz.phase0.ENRForkID.serialize(enrForkId));
  return enrForkId;
}
```

### Example 5: ENR Relevance Filtering

**File:** `packages/beacon-node/src/network/discv5/utils.ts`

```typescript
// Lines 15-49
export function enrRelevance(enr: ENR, config: BeaconConfig, clock: IClock): ENRRelevance {
  // 1. Must have TCP multiaddr for libp2p connection
  const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
  if (!multiaddrTCP) {
    return ENRRelevance.no_tcp;
  }

  // 2. Must have eth2 field for fork identification
  const eth2 = enr.kvs.get(ENRKey.eth2);
  if (!eth2) {
    return ENRRelevance.no_eth2;
  }

  // 3. Fork digest must be known
  const forkDigest = eth2.slice(0, 4);
  const {fork: forkName} = config.forkDigest2ForkBoundaryOption(forkDigest) ?? {};
  if (forkName === undefined) {
    return ENRRelevance.unknown_forkDigest;
  }

  // 4. Fork must match current or previous fork
  const currentSlot = clock.slotWithFutureTolerance(config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 1000);
  const localForkInfo = config.getForkInfo(currentSlot);
  if (forkName !== localForkInfo.name && forkName !== localForkInfo.prevForkName) {
    return ENRRelevance.current_fork_mismatch;
  }

  return ENRRelevance.relevant;
}
```

### Example 6: REST API Integration

**File:** `packages/beacon-node/src/network/core/networkCore.ts`

```typescript
// Lines 394-427
async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
  // Get ENR from discv5 worker
  const enr = await this.peerManager["discovery"]?.discv5.enr();

  // Get discovery addresses (UDP)
  const discoveryAddresses = [
    (await enr?.getFullMultiaddr("udp"))?.toString(),
    (await enr?.getFullMultiaddr("udp6"))?.toString(),
  ].filter(Boolean);

  // Get P2P addresses (TCP)
  const p2pAddresses = [
    ...this.libp2p.getMultiaddrs().map((ma) => ma.toString()),
    (await enr?.getFullMultiaddr("tcp"))?.toString(),
    (await enr?.getFullMultiaddr("tcp6"))?.toString(),
  ].filter(Boolean);

  return {
    peerId: peerIdToString(this.libp2p.peerId),
    enr: enr?.encodeTxt() || "",
    discoveryAddresses,
    p2pAddresses,
    metadata: this.metadata.json,
  };
}

// Lines 495-498
async dumpDiscv5KadValues(): Promise<string[]> {
  return (await this.peerManager["discovery"]?.discv5?.kadValues())?.map((enr) => enr.encodeTxt()) ?? [];
}
```

---

## Configuration Options

### CLI Arguments

| Argument                             | Type     | Default   | Description                |
| ------------------------------------ | -------- | --------- | -------------------------- |
| `--discv5`                           | boolean  | `true`    | Enable/disable discv5      |
| `--listenAddress`                    | string   | `0.0.0.0` | IPv4 address for P2P       |
| `--port`                             | number   | `9000`    | TCP port for libp2p        |
| `--discoveryPort`                    | number   | `port`    | UDP port for discv5        |
| `--listenAddress6`                   | string   | `::`      | IPv6 address for P2P       |
| `--port6`                            | number   | `port`    | TCP port for libp2p (IPv6) |
| `--discoveryPort6`                   | number   | `port6`   | UDP port for discv5 (IPv6) |
| `--bootnodes`                        | string[] | `[]`      | Bootstrap ENRs             |
| `--network.connectToDiscv5Bootnodes` | boolean  | `false`   | Dial bootnodes directly    |
| `--network.discv5FirstQueryDelayMs`  | number   | `1000`    | Delay first query          |

### Programmatic Options

**File:** `packages/beacon-node/src/network/options.ts`

```typescript
export type NetworkOptions = {
  discv5: LodestarDiscv5Opts | null; // null disables discv5
  targetPeers: number; // Default: 200
  maxPeers: number; // Default: 210
  discv5FirstQueryDelayMs?: number; // Default: 1000
  connectToDiscv5Bootnodes?: boolean; // Default: false
  // ... other options
};
```

### Discv5-Specific Options

**File:** `packages/beacon-node/src/network/discv5/types.ts`

```typescript
export type LodestarDiscv5Opts = {
  config?: Discv5Config; // @chainsafe/discv5 config
  enr: string; // ENR as text (set by CLI)
  bindAddrs: BindAddrs; // UDP bind addresses
  bootEnrs: string[]; // Bootstrap node ENRs
};

type BindAddrs = {
  ip4?: string; // e.g., "/ip4/0.0.0.0/udp/9000"
  ip6?: string; // e.g., "/ip6/::/udp/9000"
};
```

---

## Summary: What the Light Client Needs

To adapt discv5 for the light client, you need to:

1. **Reuse the core discv5 files** from `packages/beacon-node/src/network/discv5/`:

   - `index.ts` - Discv5Worker wrapper (can simplify to run on main thread)
   - `types.ts` - Type definitions (mostly reusable)
   - `utils.ts` - ENR relevance filtering (fully reusable)
   - `worker.ts` - Worker implementation (optional, can run on main thread)

2. **Get configuration from bootstrap**:

   - `chainConfig` - From trusted checkpoint
   - `genesisValidatorsRoot` - From trusted checkpoint
   - `genesisTime` - From trusted checkpoint

3. **Simplify the discovery logic**:

   - No subnet-aware discovery (no attnets, syncnets, custody groups)
   - Just find any peers on the correct fork
   - Simpler peer selection (don't need prioritizePeers complexity)

4. **Minimal ENR metadata**:

   - Only need `eth2` field for fork identification
   - Don't need `attnets`, `syncnets`, `cgc` fields

5. **Skip optional features**:
   - Metrics (optional)
   - Worker thread (can run on main thread for lighter weight)
   - Complex peer scoring (can use simplified version)

---

## Additional Notes for Light Client Implementation

These notes capture key insights discovered during analysis:

### Key Generation and Identity

- Private keys are generated using `generateKeyPair("secp256k1")` from `@libp2p/crypto` using cryptographically secure randomness.
- By default keys are ephemeral (new each restart); use `--persistNetworkIdentity` to save to `peer-id.json` and `enr` files for stable identity.
- Persisting identity preserves peer reputation scores across restarts and provides a stable ENR for others to find you.
- For initial light client testing, a hardcoded test key is fine; add proper key generation later.

### Why Disable Discv5

- Useful for private testnets where all peers are known upfront via static peer lists.
- Helpful when UDP is blocked but TCP works, or for debugging specific peer interactions.
- Static peers can be configured via `--bootnodes` ENRs combined with `--network.connectToDiscv5Bootnodes` to dial them directly.

### Worker Threads

- `new Worker(...)` creates actual OS threads via Node.js `worker_threads` module - true parallelism, not just event loop callbacks.
- Worker threads have separate V8 heaps, so objects like `PrivateKey` must be serialized to `Uint8Array` via protobuf for transfer.
- Keeping the worker architecture is recommended to reuse battle-tested code and avoid introducing bugs.
- Worker threads are Node.js only; browser would need different approach (WebRTC/WebSocket, no UDP).

### Message Formats

- Discv5 uses RLP-encoded messages over UDP - completely separate from gossip/req-resp.
- Gossip and req/resp use SSZ + Snappy compression over TCP via libp2p.
- The `@chainsafe/discv5` library handles all UDP message encoding internally.

### RPC in This Context

- "RPC" refers to libp2p req/resp protocol (Status, Ping, Metadata, etc.), not Ethereum JSON-RPC.
- `PeerRpcScoreStore` tracks peer behavior in these P2P request/response interactions.

### Configuration Values

- `genesisTime` comes from the genesis state, not ChainConfig preset - different networks have different genesis times.
- `BeaconConfig` = `ChainConfig` (static fork schedule) + `genesisValidatorsRoot` (runtime).
- Light client obtains these values from the bootstrap response or checkpoint sync data.

### Clock Dependency

- Clock is needed to determine current slot/epoch for fork relevance filtering.
- Light client will create Clock from `genesisTime` obtained from bootstrap data.

### Component Relationships

- NetworkCore is the public API surface; other components call methods like `publishGossip()`, `sendReqRespRequest()`.
- PeerManager is internal, handling peer lifecycle: heartbeat every 30s, discovery triggers, scoring, connect/disconnect.
- MetadataController manages ENR fields (eth2, attnets, syncnets) and keeps discv5 ENR in sync when values change.

### Discovery Behavior

- `discoverPeers()` handles both general peer discovery and subnet-specific queries (attnets, syncnets, custody groups).
- `findRandomNode()` is a Kademlia DHT lookup that populates the routing table and finds diverse peers.
- Discovery is triggered during heartbeat when more peers are needed or cached ENRs are insufficient.

### Subnets and Light Client

- Ethereum shards attestations into 64 subnets to reduce message volume; validators subscribe based on their index.
- Light client does NOT need any subnets - the two light client gossip topics are global, not sharded.
- Light client can return empty `attnets`/`syncnets` bitfields (all zeros) in Metadata responses - this is honest.
- Light client discovery simplifies to "find peers on the right fork" without subnet-aware prioritization.

### Debugging

- `getNetworkIdentity()` returns peer ID, ENR, discovery/P2P addresses, and metadata - useful for debugging connectivity.
- `dumpDiscv5KadValues()` dumps all ENRs in the Kademlia routing table.
