# Ethereum Protocol Operational Messages

This document explains the operational messages (Ping, Status, Metadata, Goodbye) that form the control plane of Ethereum's peer-to-peer networking protocol. These messages operate at the **Ethereum protocol level**, using ReqResp as the underlying network application protocol.

## Table of Contents

1. [Protocol Layering](#protocol-layering)
2. [Ping/Pong](#pingpong)
3. [Status](#status)
4. [Metadata](#metadata)
5. [Goodbye](#goodbye)
6. [Peer Lifecycle Flow](#peer-lifecycle-flow)
7. [Implementation Details](#implementation-details)
8. [Light Client Considerations](#light-client-considerations)

---

## Protocol Layering

These messages sit at different layers of the networking stack:

```
┌─────────────────────────────────────────────────────┐
│  Application Layer (Beacon Chain / Light Client)   │
│  - Processes blocks, attestations, LC updates      │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│  Ethereum Protocol Layer (Operational Messages)     │ ← THIS DOCUMENT
│  - Ping: Keepalive, latency checks                 │
│  - Status: Chain state synchronization              │
│  - Metadata: Peer capabilities and subnets          │
│  - Goodbye: Graceful disconnection                  │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│  Network Application Protocol (ReqResp)             │
│  - Request/Response streaming                       │
│  - SSZ encoding, Snappy compression                 │
│  - Protocol negotiation                             │
└─────────────────────────────────────────────────────┘
                        ↕
┌─────────────────────────────────────────────────────┐
│  Transport Layer (libp2p)                           │
│  - TCP connections, multiplexing                    │
│  - Noise encryption, peer identification            │
└─────────────────────────────────────────────────────┘
```

**Key Distinction**:
- **ReqResp** is the network protocol (how to send/receive messages)
- **Ping/Status/Metadata/Goodbye** are Ethereum protocol messages (what to send)

---

## Ping/Pong

### Purpose

**Ping** is a keepalive and latency measurement mechanism. It serves multiple purposes:

1. **Keepalive**: Ensures TCP connection stays alive through NATs/firewalls
2. **Liveness Check**: Verifies peer is still responsive
3. **Latency Measurement**: Can measure round-trip time (though Lodestar doesn't use this currently)
4. **Connection Quality**: Timeouts indicate poor connection

### Protocol Details

**Protocol ID**: `/eth2/beacon_chain/req/ping/1/ssz_snappy`

**Request Type**: `uint64` (sequence number)

**Response Type**: `uint64` (echo of sequence number)

**Flow**:
```
Peer A                                    Peer B
  │                                         │
  ├─────── Ping(seqNumber=1) ────────────→│
  │                                         │
  │                                         ├─ Verify format
  │                                         ├─ Echo seqNumber
  │                                         │
  │←────── Pong(seqNumber=1) ──────────────┤
  │                                         │
  ├─ Verify seqNumber matches              │
```

### Timing in Lodestar

**File**: `packages/beacon-node/src/network/peers/peerManager.ts`

```typescript
// Ping intervals
const PING_INTERVAL_OUTBOUND_MS = 20_000;  // 20 seconds for outbound peers
const PING_INTERVAL_INBOUND_MS = 15_000;   // 15 seconds for inbound peers
```

**Why different intervals?**
- **Outbound peers**: You dialed them, probably more valuable, ping less frequently
- **Inbound peers**: They dialed you, might be transient, check more frequently

### When Ping Happens

1. **Periodic Heartbeat**: Every 15-20 seconds (see above)
2. **After Connection**: First ping shortly after connection establishment
3. **Score-Based**: If peer score drops, may ping more frequently to verify liveness

### Timeout Handling

**File**: `packages/beacon-node/src/network/reqresp/score.ts:81-84`

```typescript
case RequestErrorCode.DIAL_TIMEOUT:
  return method === ReqRespMethod.Ping
    ? PeerAction.Fatal  // ← Immediate ban
    : PeerAction.LowToleranceError;
```

**Why Fatal for Ping timeout?**
- Ping is the simplest request (just echo a number)
- If peer can't respond to Ping, it's fundamentally broken
- No excuse for Ping failure

### Metadata Exchange

Ping responses include **no metadata**. It's purely a sequence number echo. All metadata exchange happens via the `Metadata` message.

---

## Status

### Purpose

**Status** is the chain state synchronization mechanism. It serves to:

1. **Fork Compatibility**: Ensure peers are on same fork
2. **Sync Coordination**: Understand peer's chain state for syncing
3. **Peer Relevance**: Filter out peers on different/incompatible chains
4. **Finality Tracking**: Know peer's finalized checkpoint

### Protocol Details

**Protocol ID**: `/eth2/beacon_chain/req/status/1/ssz_snappy`

**Request Type**: `Status` (SSZ container)

**Response Type**: `Status` (SSZ container)

### Status Message Structure

**Version 1** (Phase 0 - Deneb):
```typescript
type Status = {
  forkDigest: Bytes4;        // Current fork identifier
  finalizedRoot: Root;       // Finalized checkpoint root
  finalizedEpoch: Epoch;     // Finalized checkpoint epoch
  headRoot: Root;            // Chain head root
  headSlot: Slot;            // Chain head slot
}
```

**Version 2** (Fulu+):
```typescript
type Status = {
  forkDigest: Bytes4;
  finalizedRoot: Root;
  finalizedEpoch: Epoch;
  headRoot: Root;
  headSlot: Slot;
  earliestAvailableSlot: Slot;  // ← NEW: Oldest data available
}
```

**Field Explanations**:

| Field | Purpose |
|-------|---------|
| `forkDigest` | 4-byte hash identifying the fork (e.g., Deneb, Fulu). Computed from fork version + genesis validators root. Prevents cross-fork communication. |
| `finalizedRoot` | Root hash of the finalized beacon block. This is the checkpoint both peers should agree on. |
| `finalizedEpoch` | Epoch of finalization. Used to detect if peer is ahead/behind. |
| `headRoot` | Root of peer's current chain head (tip of chain). |
| `headSlot` | Slot number of chain head. Used to determine if peer is ahead/behind/equal. |
| `earliestAvailableSlot` | (Fulu+) Oldest slot for which peer has full data (blocks + blobs). Relevant for historical sync and data availability. |

### Status Exchange Flow

```
Peer A                                    Peer B
  │                                         │
  ├─────── Status(A's state) ────────────→│
  │                                         │
  │                                         ├─ Validate forkDigest
  │                                         ├─ Check finalized agreement
  │                                         ├─ Check clock agreement
  │                                         │
  │←────── Status(B's state) ──────────────┤
  │                                         │
  ├─ Validate forkDigest                   │
  ├─ Check finalized agreement             │
  ├─ Check clock agreement                 │
  │                                         │
  ├─ If all checks pass: KEEP PEER         │
  ├─ If any check fails: DISCONNECT        │
```

### When Status Happens

**File**: `packages/beacon-node/src/network/peers/peerManager.ts`

```typescript
const STATUS_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const STATUS_INBOUND_GRACE_PERIOD = 15_000; // 15 seconds for new peers
```

**Timing**:
1. **Immediately After Connection**: First Status exchange within seconds of connection
2. **Periodic Re-Status**: Every 5 minutes to detect chain drift
3. **After Fork**: When local chain fork changes
4. **Grace Period**: New inbound peers get 15s before first Status check

### Status Validation

**File**: `packages/beacon-node/src/network/peers/utils/assertPeerRelevance.ts`

Four critical checks are performed:

#### 1. Fork Compatibility Check

```typescript
if (local.forkDigest !== remote.forkDigest) {
  // Disconnect with INCOMPATIBLE_FORKS
  // Different fork = can't communicate
}
```

**Why this matters**: Prevents communication between incompatible forks (e.g., Deneb vs Fulu). Even if genesis validators root matches, fork digest must match.

#### 2. Clock Agreement Check

```typescript
if (remote.headSlot > currentSlot + FUTURE_SLOT_TOLERANCE) {
  // Disconnect with DIFFERENT_CLOCKS
  // Peer is too far in the future
}

const FUTURE_SLOT_TOLERANCE = 1;  // Allow 1 slot ahead
```

**Why this matters**: Prevents attacks where malicious peer claims to be far ahead to trigger unnecessary sync attempts.

#### 3. Finalized Checkpoint Agreement

```typescript
if (remote.finalizedEpoch === local.finalizedEpoch &&
    remote.finalizedRoot !== local.finalizedRoot) {
  // Disconnect with DIFFERENT_FINALIZED
  // Same epoch, different root = incompatible chains
}
```

**Why this matters**: If both peers finalized the same epoch but disagree on the root, they're on conflicting chains (fork in the past). No point staying connected.

**Important**: If `remote.finalizedEpoch > local.finalizedEpoch`, we **accept** the peer. We can't verify their future checkpoint, but they might help us catch up.

#### 4. Earliest Available Slot Check (Fulu+)

```typescript
if (isForkPostFulu(currentFork) && !remote.earliestAvailableSlot) {
  // Disconnect with NO_EARLIEST_AVAILABLE_SLOT
  // Fulu+ peers must advertise data availability
}
```

**Why this matters**: After Fulu, nodes must declare how far back they have full data (including blobs). This is critical for data availability sampling.

### Status Usage by Sync

After Status validation passes, the sync module uses the peer's Status to determine:

- **Is peer ahead?** (`remote.headSlot > local.headSlot`) → Request blocks from peer
- **Is peer behind?** (`remote.headSlot < local.headSlot`) → Peer might request blocks from us
- **Is peer synced?** (`remote.finalizedEpoch ≈ local.finalizedEpoch`) → Good peer for gossip

---

## Metadata

### Purpose

**Metadata** exchanges peer capabilities and network participation. It serves to:

1. **Subnet Advertisement**: Declare which attestation/sync committee subnets peer subscribes to
2. **Sequence Number Tracking**: Detect when peer updates their metadata
3. **Capability Discovery**: Understand what topics peer participates in
4. **Gossip Mesh Formation**: Help form efficient gossip meshes for subnets

### Protocol Details

**Protocol ID**:
- V1: `/eth2/beacon_chain/req/metadata/1/ssz_snappy`
- V2: `/eth2/beacon_chain/req/metadata/2/ssz_snappy` (Altair+)
- V3: `/eth2/beacon_chain/req/metadata/3/ssz_snappy` (Fulu+)

**Request Type**: `null` (empty request)

**Response Type**: `Metadata` (SSZ container, version-dependent)

### Metadata Structure Evolution

**V1 (Phase 0)**:
```typescript
type MetadataV1 = {
  seqNumber: uint64;         // Increments on each update
  attnets: Bitvector[64];    // Attestation subnet subscriptions
}
```

**V2 (Altair+)**:
```typescript
type MetadataV2 = {
  seqNumber: uint64;
  attnets: Bitvector[64];    // Attestation subnets (0-63)
  syncnets: Bitvector[4];    // Sync committee subnets (0-3)
}
```

**V3 (Fulu+)**:
```typescript
type MetadataV3 = {
  seqNumber: uint64;
  attnets: Bitvector[64];
  syncnets: Bitvector[4];
  custodyGroupCount: uint64; // Number of custody groups (PeerDAS)
}
```

### Field Explanations

| Field | Purpose |
|-------|---------|
| `seqNumber` | Monotonically increasing counter. Incremented whenever peer updates their metadata. Allows detecting stale metadata. |
| `attnets` | 64-bit bitvector where bit `i` = 1 means peer is subscribed to attestation subnet `i`. Used for subnet discovery and gossip mesh formation. |
| `syncnets` | 4-bit bitvector where bit `i` = 1 means peer is subscribed to sync committee subnet `i`. |
| `custodyGroupCount` | (Fulu+) Number of custody groups peer is responsible for in PeerDAS. Used for data availability sampling. |

### Metadata Exchange Flow

```
Peer A                                    Peer B
  │                                         │
  ├─────── Metadata Request ─────────────→│
  │        (empty body)                     │
  │                                         │
  │                                         ├─ Read current metadata
  │                                         ├─ Serialize to SSZ
  │                                         │
  │←────── Metadata Response ───────────────┤
  │        { seqNumber, attnets, ... }      │
  │                                         │
  ├─ Store metadata                        │
  ├─ Update peer's subnet subscriptions    │
```

### When Metadata is Requested

**Initial Request**:
- Shortly after connection establishment
- Before peer is considered "fully connected"

**Subsequent Requests**:
- When peer's ENR seqNumber updates (detected via discv5)
- Periodically (not as frequent as Status)
- When subnet subscriptions change (rare)

### Metadata Usage

**1. Subnet Discovery** (`PeerDiscovery`):
```typescript
// Find peers subscribed to subnet 5
const peersOnSubnet5 = connectedPeers.filter(peer =>
  peer.metadata.attnets[5] === true
);
```

**2. Pruning Decisions** (`prioritizePeers.ts`):
```typescript
// Peers with no subnets are pruned first
if (peer.metadata.attnets.allZeros() && peer.metadata.syncnets.allZeros()) {
  priorityScore = LOWEST_PRIORITY;
}
```

**3. Gossip Mesh Formation**:
- Gossipsub uses metadata to preferentially peer with nodes on same subnets
- Helps form efficient meshes (all mesh members are interested in the topic)

**4. Peer Selection for Requests**:
```typescript
// Need attestations from subnet 7
const candidates = peers.filter(p => p.metadata.attnets[7]);
const peer = selectBestPeer(candidates);
```

### Metadata Update Propagation

**MetadataController** manages local metadata:

**File**: `packages/beacon-node/src/network/metadata.ts`

```typescript
class MetadataController {
  private metadata: {
    seqNumber: number;
    attnets: BitArray;
    syncnets: BitArray;
    custodyGroupCount?: number;
  };

  // Called when subnets change
  setAttnets(attnets: BitArray) {
    this.metadata.attnets = attnets;
    this.metadata.seqNumber++;  // ← Increment!
    this.updateENR();  // Update discv5 ENR
  }
}
```

**ENR Synchronization**:
- Metadata is also stored in the ENR (Ethereum Node Record)
- discv5 propagates ENR updates to the network
- Peers can discover your subnets before connecting (via ENR)

---

## Goodbye

### Purpose

**Goodbye** is a graceful disconnection message. It serves to:

1. **Signal Intent**: Clearly communicate why disconnecting
2. **Enable Cool-Down**: Allow peer to implement reconnection backoff
3. **Debugging**: Provide reason codes for troubleshooting
4. **Score Preservation**: Some reasons don't penalize peer score

### Protocol Details

**Protocol ID**: `/eth2/beacon_chain/req/goodbye/1/ssz_snappy`

**Request Type**: `uint64` (reason code)

**Response Type**: `uint64` (empty response, just acknowledgment)

**Flow**:
```
Peer A (disconnecting)                    Peer B
  │                                         │
  ├─────── Goodbye(reason=2) ────────────→│
  │                                         │
  │                                         ├─ Log reason
  │                                         ├─ Set cool-down
  │                                         ├─ Close connection
  │                                         │
  │←────── (empty response) ────────────────┤
  │                                         │
  ├─ Close connection                      │
```

### Goodbye Reason Codes

**File**: `@lodestar/types` (phase0 namespace)

```typescript
enum GoodbyeReasonCode {
  CLIENT_SHUTDOWN = 1,
  IRRELEVANT_NETWORK = 2,
  ERROR = 3,
  TOO_MANY_PEERS = 129,
  SCORE_TOO_LOW = 130,
  BANNED = 131,
  // Custom Lodestar codes (not in spec)
  INBOUND_DISCONNECT = 132,
}
```

### Reason Code Meanings

| Code | Name | Meaning | Initiated By |
|------|------|---------|--------------|
| 1 | `CLIENT_SHUTDOWN` | Peer is shutting down gracefully | Either |
| 2 | `IRRELEVANT_NETWORK` | Peer is on different network/fork | Either |
| 3 | `ERROR` | General error occurred | Either |
| 129 | `TOO_MANY_PEERS` | Peer has reached max connections | Peer being dialed |
| 130 | `SCORE_TOO_LOW` | Peer's score dropped below threshold | Scorer |
| 131 | `BANNED` | Peer is banned (score ≤ -50) | Scorer |
| 132 | `INBOUND_DISCONNECT` | Inbound peer disconnected (custom Lodestar) | N/A |

### Cool-Down Periods

**File**: `packages/beacon-node/src/network/peers/score/score.ts:56-78`

Different reasons trigger different cool-down periods before reconnection:

| Reason | Cool-Down | Why |
|--------|-----------|-----|
| `BANNED` | None (score decay) | Score must naturally decay from ≤ -50 |
| `SCORE_TOO_LOW` | None (score decay) | Score must naturally decay from ≤ -20 |
| `INBOUND_DISCONNECT` | 5 minutes | Peer left, give them time |
| `TOO_MANY_PEERS` | 5 minutes | Peer is full, try later |
| `ERROR` | 60 minutes | Something went wrong, wait longer |
| `CLIENT_SHUTDOWN` | 60 minutes | Peer is restarting, wait |
| `IRRELEVANT_NETWORK` | 240 minutes (4 hours) | Wrong network, no rush to retry |

**Implementation**:
```typescript
class RealScore {
  private goodbyeTime: number | null = null;
  private goodbyeReason: GoodbyeReasonCode | null = null;

  farewell(reason: GoodbyeReasonCode) {
    this.goodbyeTime = Date.now();
    this.goodbyeReason = reason;
  }

  isCoolingDown(now: number): boolean {
    if (!this.goodbyeTime) return false;

    const elapsed = now - this.goodbyeTime;
    const coolDown = this.getCoolDown(this.goodbyeReason);

    return elapsed < coolDown;
  }
}
```

### When Goodbye is Sent

**1. Peer Pruning**:
```typescript
// Too many peers, pruning lowest priority
await network.goodbye(peerId, GoodbyeReasonCode.TOO_MANY_PEERS);
```

**2. Score-Based Disconnect**:
```typescript
if (peerScore <= MIN_SCORE_BEFORE_DISCONNECT) {
  await network.goodbye(peerId, GoodbyeReasonCode.SCORE_TOO_LOW);
}

if (peerScore <= MIN_SCORE_BEFORE_BAN) {
  await network.goodbye(peerId, GoodbyeReasonCode.BANNED);
}
```

**3. Status Validation Failure**:
```typescript
if (local.forkDigest !== remote.forkDigest) {
  await network.goodbye(peerId, GoodbyeReasonCode.IRRELEVANT_NETWORK);
}
```

**4. Node Shutdown**:
```typescript
async close() {
  for (const peerId of this.getConnectedPeers()) {
    await network.goodbye(peerId, GoodbyeReasonCode.CLIENT_SHUTDOWN);
  }
}
```

### Goodbye Handling

**Receiving a Goodbye**:
```typescript
// When peer sends us Goodbye
onGoodbye(peerId: PeerId, reason: GoodbyeReasonCode) {
  this.logger.debug("Received goodbye", {peerId, reason});

  // Set cool-down
  this.peerScoreStore.farewell(peerId, reason);

  // Disconnect
  this.libp2p.hangup(peerId);
}
```

**Score Impact**:
- Goodbye itself doesn't change peer score
- The underlying reason (if score-based) already affected score
- Cool-down prevents immediate reconnection

---

## Peer Lifecycle Flow

Here's how these messages fit into the complete peer lifecycle:

```
┌──────────────────────────────────────────────────────────────┐
│ DISCOVERY PHASE                                              │
│   - Discv5 discovers ENR                                     │
│   - Filter by fork digest (ENR eth2 field)                   │
│   - Dial TCP address                                         │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ CONNECTION PHASE                                             │
│   - TCP handshake                                            │
│   - Noise encryption handshake                               │
│   - Multistream protocol negotiation                         │
│   - libp2p connection established                            │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ STATUS EXCHANGE (Within seconds)                             │
│   - Exchange Status messages                                 │
│   - Validate forkDigest                                      │
│   - Check finalized agreement                                │
│   - Check clock agreement                                    │
│   → FAIL: Send Goodbye(IRRELEVANT_NETWORK), disconnect       │
│   → PASS: Continue to next phase                             │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ METADATA EXCHANGE (Shortly after Status)                     │
│   - Request peer's Metadata                                  │
│   - Store attnets/syncnets/custodyGroupCount                 │
│   - Update subnet tracking for peer discovery                │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ OPERATIONAL PHASE (Peer fully connected)                     │
│   ┌────────────────────────────────────────────────────────┐ │
│   │ PERIODIC PING                                          │ │
│   │   Every 15-20s: Send Ping, measure latency            │ │
│   │   Timeout → Score penalty (possibly ban)              │ │
│   └────────────────────────────────────────────────────────┘ │
│   ┌────────────────────────────────────────────────────────┐ │
│   │ PERIODIC STATUS                                        │ │
│   │   Every 5min: Re-exchange Status                      │ │
│   │   Detect chain drift, fork changes                    │ │
│   │   Mismatch → Send Goodbye, disconnect                 │ │
│   └────────────────────────────────────────────────────────┘ │
│   ┌────────────────────────────────────────────────────────┐ │
│   │ GOSSIP & REQRESP                                       │ │
│   │   Exchange blocks, attestations, LC updates           │ │
│   │   Misbehavior → Score penalties                       │ │
│   └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ DISCONNECTION PHASE (One of these triggers)                 │
│   1. Score too low → Send Goodbye(SCORE_TOO_LOW)            │
│   2. Banned → Send Goodbye(BANNED)                          │
│   3. Too many peers → Send Goodbye(TOO_MANY_PEERS)          │
│   4. Peer sent Goodbye → Acknowledge, disconnect            │
│   5. Network error → Send Goodbye(ERROR)                    │
│   6. Node shutdown → Send Goodbye(CLIENT_SHUTDOWN)          │
└──────────────────────────────────────────────────────────────┘
                        ↓
┌──────────────────────────────────────────────────────────────┐
│ COOL-DOWN PHASE                                              │
│   - Score decays exponentially (10min half-life)            │
│   - Goodbye reason determines cool-down duration             │
│   - Can't reconnect until cool-down expires                  │
│   - After recovery: Can rediscover and reconnect             │
└──────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### Message Encoding

All four messages use the same encoding stack:

```
Message Data (Rust/TS object)
  ↓
SSZ Serialization (type-specific)
  ↓
Snappy Compression
  ↓
ReqResp Framing (length-prefix)
  ↓
libp2p Stream (TCP)
```

### Example: Status Encoding

```typescript
// TypeScript structure
const status: Status = {
  forkDigest: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
  finalizedRoot: new Uint8Array(32),  // 32 bytes
  finalizedEpoch: 100n,
  headRoot: new Uint8Array(32),
  headSlot: 3200n,
  earliestAvailableSlot: 0n,  // V2 only
};

// SSZ serialize
const sszBytes = ssz.phase0.Status.serialize(status);

// Snappy compress
const compressed = snappy.compress(sszBytes);

// ReqResp frame (length-prefix)
const frame = encodeLengthPrefix(compressed);

// Send over libp2p stream
await stream.write(frame);
```

### Timeout Values

**File**: `@lodestar/reqresp` (configurable)

| Message | Timeout | Reason |
|---------|---------|--------|
| Ping | 10s | Simple echo, should be instant |
| Status | 10s | Small message, should be quick |
| Metadata | 10s | Small message, should be quick |
| Goodbye | 10s | Acknowledgment only |

### Error Handling

Each message type has specific error handling:

**Ping Errors**:
- Timeout → `PeerAction.Fatal` (immediate ban)
- Invalid response → `PeerAction.LowToleranceError`

**Status Errors**:
- Timeout → `PeerAction.LowToleranceError`
- Validation failure → Send Goodbye, disconnect (no score penalty)

**Metadata Errors**:
- Timeout → `PeerAction.LowToleranceError`
- Unsupported protocol → `PeerAction.LowToleranceError`

**Goodbye Errors**:
- Timeout → Ignore (already disconnecting)
- Error → Force disconnect

---

## Light Client Considerations

### Messages Light Clients Need

| Message | Required? | Purpose |
|---------|-----------|---------|
| **Ping** | ✅ Yes | Keepalive, liveness checks |
| **Status** | ✅ Yes | Fork compatibility, peer filtering |
| **Metadata** | ⚠️ Partial | Only for debugging/stats (no subnets used) |
| **Goodbye** | ✅ Yes | Graceful disconnect |

### Status for Light Clients

Light clients have different chain state:

**Beacon Node Status**:
```typescript
{
  forkDigest: <current fork>,
  finalizedRoot: <fork choice finalized>,
  finalizedEpoch: <fork choice epoch>,
  headRoot: <fork choice head>,
  headSlot: <fork choice head slot>,
  earliestAvailableSlot: <oldest block>
}
```

**Light Client Status**:
```typescript
{
  forkDigest: <current fork>,           // Same
  finalizedRoot: <LC finalized header>, // From LC update
  finalizedEpoch: <LC finalized slot>,  // From LC update
  headRoot: <LC optimistic header>,     // From LC update
  headSlot: <LC optimistic slot>,       // From LC update
  earliestAvailableSlot: undefined      // Not relevant
}
```

**Key Differences**:
1. **Finalized comes from LC updates**, not fork choice
2. **Head comes from optimistic updates**, not fork choice
3. **earliestAvailableSlot** should be omitted or set to 0 (LC doesn't track historical blocks)

### Metadata for Light Clients

Light clients don't participate in subnets:

**Beacon Node Metadata**:
```typescript
{
  seqNumber: 5,
  attnets: [0,1,0,0,1,0,...],  // 64 bits
  syncnets: [1,0,1,0],         // 4 bits
  custodyGroupCount: 2
}
```

**Light Client Metadata**:
```typescript
{
  seqNumber: 1,
  attnets: [0,0,0,0,0,0,...],  // All zeros
  syncnets: [0,0,0,0],         // All zeros
  custodyGroupCount: 0         // Not participating in PeerDAS
}
```

**Implications**:
- Light clients will be pruned first by beacon nodes (no subnets = low value)
- This is OK! Light clients need fewer peers (10-30 vs 200)
- Light clients should prioritize keeping peers that serve LC data

### Goodbye Reasons for Light Clients

Light clients should handle:

**Outgoing**:
- `TOO_MANY_PEERS`: When pruning (though rare with only 10-30 target)
- `SCORE_TOO_LOW`: When peer doesn't serve LC data
- `IRRELEVANT_NETWORK`: Wrong fork detected via Status
- `CLIENT_SHUTDOWN`: When light client closes

**Incoming**:
- `TOO_MANY_PEERS`: Beacon node is full (normal, retry later)
- `SCORE_TOO_LOW`: Light client misbehaved somehow
- Any reason: Respect cool-down, don't immediately reconnect

---

## Summary

These four operational messages form the **control plane** of Ethereum's p2p protocol:

| Message | Frequency | Purpose | Critical? |
|---------|-----------|---------|-----------|
| **Ping** | Every 15-20s | Keepalive, liveness | ✅ Yes |
| **Status** | Initial + every 5min | Chain sync, fork compat | ✅ Yes |
| **Metadata** | Initial + on change | Subnet discovery | ⚠️ Partial |
| **Goodbye** | On disconnect | Graceful disconnect | ✅ Yes |

**Key Takeaways**:
1. **Layering**: These operate at Ethereum protocol level, using ReqResp as transport
2. **Status is critical**: Validates fork compatibility before any data exchange
3. **Ping is simple but important**: Cheapest liveness check, timeout = ban
4. **Metadata enables discovery**: Helps form efficient subnet-based gossip meshes
5. **Goodbye enables recovery**: Cool-downs prevent reconnection storms

**Light Client Adaptations**:
- ✅ Use Ping/Status/Goodbye as-is
- ⚠️ Metadata: All zeros (no subnets)
- ⚠️ Status: Use LC finalized/optimistic headers instead of fork choice
- ✅ Expect to be pruned by full nodes (acceptable, need fewer peers anyway)
