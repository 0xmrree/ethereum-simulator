# Gossip (GossipSub) Analysis for Light Client P2P

This document provides a detailed analysis of the gossipsub implementation in the Lodestar beacon node, with focus on understanding how to adapt it for the light client P2P networking layer.

## Table of Contents

1. [What is Gossip?](#what-is-gossip)
2. [Main Structure and Classes](#main-structure-and-classes)
3. [All Gossip Types](#all-gossip-types)
4. [Light Client Specific Topics](#light-client-specific-topics)
5. [Topic String Format](#topic-string-format)
6. [Topic Subscription Flow](#topic-subscription-flow)
7. [Message Encoding (SSZ + Snappy)](#message-encoding-ssz--snappy)
8. [Message ID Calculation](#message-id-calculation)
9. [Message Validation Pipeline](#message-validation-pipeline)
10. [Light Client Validation Logic](#light-client-validation-logic)
11. [Gossip Peer Scoring](#gossip-peer-scoring)
12. [GossipSub Configuration Parameters](#gossipsub-configuration-parameters)
13. [Publishing Messages](#publishing-messages)
14. [Fork Transitions](#fork-transitions)
15. [Dependencies](#dependencies)
16. [Code Examples](#code-examples)
17. [Key Files Reference](#key-files-reference)

---

## What is Gossip?

Gossip (GossipSub) is the **push-based** P2P protocol in Ethereum consensus. Unlike req/resp (pull-based), the **producer pushes** data to interested peers:

- **Publisher** sends a message to a gossip topic
- **Subscribers** to that topic receive the message via mesh propagation
- Uses **libp2p GossipSub** protocol (v1.1) over TCP
- Messages are **SSZ + Snappy** encoded

Key characteristics:
- Pub/sub model: peers subscribe to topics and receive messages passively
- Mesh-based: each peer maintains a mesh of D peers per topic (default D=8)
- Flood publishing: messages first published are sent to all mesh + fanout peers
- Message deduplication via message IDs (SHA256-based)
- Peer scoring affects mesh membership

---

## Main Structure and Classes

### Eth2Gossipsub
**File**: `packages/beacon-node/src/network/gossip/gossipsub.ts`

The main class that extends `GossipSub` from `@chainsafe/libp2p-gossipsub`. It adds:
- Ethereum-specific message ID calculation
- Snappy data transform (compression/decompression)
- Topic subscription/unsubscription helpers
- Event-based message routing to `NetworkProcessor`
- Peer scoring with Eth2-specific parameters

```typescript
export class Eth2Gossipsub extends GossipSub {
  subscribeTopic(topic: GossipTopic): void;
  unsubscribeTopic(topic: GossipTopic): void;
  // Receives gossipsub:message events, emits to NetworkEventBus
  private onGossipsubMessage(event): void;
  // Receives validation results, reports back to gossipsub
  private onValidationResult(data): void;
}
```

### GossipTopicCache
**File**: `packages/beacon-node/src/network/gossip/topic.ts`

Caches parsed topic objects by topic string for performance. Used during message routing to avoid re-parsing topic strings on every message.

```typescript
export class GossipTopicCache {
  getTopic(topicStr: string): GossipTopic;       // Parse or retrieve cached
  getKnownTopic(topicStr: string): GossipTopic | undefined;  // Cached only
  setTopic(topicStr: string, topic: GossipTopic): void;       // Pre-cache on subscribe
}
```

### DataTransformSnappy
**File**: `packages/beacon-node/src/network/gossip/encoding.ts`

Handles compression/decompression of gossip message payloads. Registered as a data transform with the GossipSub instance.

```typescript
export class DataTransformSnappy implements DataTransform {
  inboundTransform(topicStr: string, data: Uint8Array): Uint8Array;   // decompress
  outboundTransform(topicStr: string, data: Uint8Array): Uint8Array;  // compress
}
```

---

## All Gossip Types

**File**: `packages/beacon-node/src/network/gossip/interface.ts`

```typescript
export enum GossipType {
  beacon_block = "beacon_block",
  blob_sidecar = "blob_sidecar",
  data_column_sidecar = "data_column_sidecar",
  beacon_aggregate_and_proof = "beacon_aggregate_and_proof",
  beacon_attestation = "beacon_attestation",
  voluntary_exit = "voluntary_exit",
  proposer_slashing = "proposer_slashing",
  attester_slashing = "attester_slashing",
  sync_committee_contribution_and_proof = "sync_committee_contribution_and_proof",
  sync_committee = "sync_committee",
  light_client_finality_update = "light_client_finality_update",
  light_client_optimistic_update = "light_client_optimistic_update",
  bls_to_execution_change = "bls_to_execution_change",
}
```

Topics are divided into:
- **Global topics**: No subnet suffix (e.g., `beacon_block`, `light_client_finality_update`)
- **Subnet topics**: Have `_{subnet}` suffix (e.g., `beacon_attestation_0`, `sync_committee_3`)

Light client topics are both **global** -- no subnet is needed.

---

## Light Client Specific Topics

The light client needs only two gossip topics:

### light_client_finality_update
- **SSZ Type**: `LightClientFinalityUpdate` (fork-specific via `sszTypesFor(fork)`)
- **Available since**: Altair fork
- **Data**: Contains finalized header, attested header, sync aggregate, signature slot
- **Frequency**: One per epoch (when finality changes)
- **Validation**: Check for duplicates, timing, match against local state

### light_client_optimistic_update
- **SSZ Type**: `LightClientOptimisticUpdate` (fork-specific via `sszTypesFor(fork)`)
- **Available since**: Altair fork
- **Data**: Contains attested header, sync aggregate, signature slot
- **Frequency**: One per slot
- **Validation**: Check for duplicates, timing, match against local state

Both topics are registered in `getCoreTopicsAtFork()` when `!disableLightClientServer`:

```typescript
// File: packages/beacon-node/src/network/gossip/topic.ts (line 266-271)
if (ForkSeq[fork] >= ForkSeq.altair) {
  topics.push({type: GossipType.sync_committee_contribution_and_proof});
  if (!opts.disableLightClientServer) {
    topics.push({type: GossipType.light_client_optimistic_update});
    topics.push({type: GossipType.light_client_finality_update});
  }
}
```

---

## Topic String Format

Topic strings follow the Ethereum consensus spec format:

```
/eth2/{FORK_DIGEST_HEX}/{GOSSIP_TYPE}/{ENCODING}
```

Examples:
```
/eth2/4a26c58b/light_client_finality_update/ssz_snappy
/eth2/4a26c58b/light_client_optimistic_update/ssz_snappy
/eth2/4a26c58b/beacon_block/ssz_snappy
/eth2/4a26c58b/beacon_attestation_3/ssz_snappy
```

Key functions:
- `stringifyGossipTopic()` - Converts `GossipTopic` object to topic string
- `parseGossipTopic()` - Parses topic string back to `GossipTopic` object using regex `/^\/eth2\/(\w+)\/(\w+)\/(\w+)/`
- The fork digest hex (no `0x` prefix) is derived from the `ForkBoundary` using `forkBoundary2ForkDigestHex()`

The `ForkDigestContext` (from `@lodestar/config`) provides the bidirectional mapping between fork boundaries and fork digest hex strings.

---

## Topic Subscription Flow

1. **`NetworkCore`** calls `subscribeGossipCoreTopics()` on initialization and fork transitions
2. **`getCoreTopicsAtFork()`** returns the list of topics for a given fork
3. Each topic type is combined with the fork's `ForkBoundary` to create a full `GossipTopic`
4. **`Eth2Gossipsub.subscribeTopic()`** is called for each topic:
   - Converts topic to string via `stringifyGossipTopic()`
   - Registers in `GossipTopicCache`
   - Calls underlying `GossipSub.subscribe(topicStr)`
5. GossipSub protocol handles mesh formation with peers sharing the same topic

For fork transitions, old topics are unsubscribed and new fork topics subscribed. There's a `FORK_EPOCH_LOOKAHEAD` buffer to pre-subscribe before the fork activates.

---

## Message Encoding (SSZ + Snappy)

Gossip messages use the same SSZ + Snappy encoding as req/resp, but with different framing:

### Gossip framing (protobuf envelope)
Unlike req/resp which uses a custom status+context+length-prefix framing, gossip messages are wrapped in a **protobuf envelope** by the GossipSub protocol itself. The application only deals with the inner payload.

### Inbound flow (receiving)
1. GossipSub receives protobuf-framed message from peer
2. `DataTransformSnappy.inboundTransform()` is called:
   - Checks uncompressed length via `snappyWasm.decompress_len(data)`
   - Validates against the SSZ type's `minSize` and `maxSize`
   - Decompresses via `decoder.decompress_into(data, uncompressedData)`
3. Decompressed SSZ bytes are passed to the handler for deserialization

### Outbound flow (publishing)
1. Application serializes the object to SSZ bytes
2. `DataTransformSnappy.outboundTransform()` is called:
   - Validates data length against `maxSizePerMessage`
   - Compresses via `encoder.compress_into(data, compressedData)`
3. GossipSub wraps in protobuf and publishes

### SSZ type resolution
**File**: `packages/beacon-node/src/network/gossip/topic.ts`

```typescript
// For light client topics:
case GossipType.light_client_optimistic_update:
  return isForkPostAltair(fork)
    ? sszTypesFor(fork).LightClientOptimisticUpdate
    : ssz.altair.LightClientOptimisticUpdate;
case GossipType.light_client_finality_update:
  return isForkPostAltair(fork)
    ? sszTypesFor(fork).LightClientFinalityUpdate
    : ssz.altair.LightClientFinalityUpdate;
```

---

## Message ID Calculation

Message IDs are used for deduplication and are spec-defined.

### Fast Message ID (deduplication shortcut)
**File**: `packages/beacon-node/src/network/gossip/encoding.ts`

```typescript
export function fastMsgIdFn(rpcMsg: RPC.Message): string {
  if (rpcMsg.data) {
    return xxhash.h64Raw(rpcMsg.data, h64Seed).toString(16);
  }
  return "0000000000000000";
}
```
- Uses xxhash (WASM) for fast deduplication before full SHA256 computation
- Random seed prevents collision mining

### Full Message ID (spec-compliant)
```typescript
export function msgIdFn(gossipTopicCache: GossipTopicCache, msg: Message): Uint8Array {
  // Phase0:  SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + snappy_decompress(data))[:20]
  // Altair+: SHA256(MESSAGE_DOMAIN_VALID_SNAPPY + uint_to_bytes(len(topic)) + topic + snappy_decompress(data))[:20]
}
```

Key constants:
- `MESSAGE_DOMAIN_VALID_SNAPPY = 0x01000000` (valid messages)
- `MESSAGE_DOMAIN_INVALID_SNAPPY = 0x00000000` (invalid messages)
- Message ID length: 20 bytes

---

## Message Validation Pipeline

### Flow
```
Eth2Gossipsub.onGossipsubMessage()
  → NetworkEventBus.emit(pendingGossipsubMessage)
  → NetworkProcessor.onPendingGossipsubMessage()
  → GossipQueue (per type)
  → Handler function (validates + processes)
  → NetworkEventBus.emit(gossipMessageValidationResult)
  → Eth2Gossipsub.reportMessageValidationResult()
```

### Validation Results
Messages are validated with three possible outcomes:
- **ACCEPT**: Valid message, propagate to mesh peers
- **REJECT**: Invalid message, do not propagate, penalize sending peer
- **IGNORE**: Not invalid but not useful (duplicate, too early, etc.), do not propagate, no penalty

These map to `TopicValidatorResult` from libp2p and affect both message propagation and peer scoring.

### Async validation
GossipSub is configured with `asyncValidation: true`, meaning messages are held in a pending state until the validation result is reported back. This prevents propagating unvalidated messages.

---

## Light Client Validation Logic

### Finality Update Validation
**File**: `packages/beacon-node/src/chain/validation/lightClientFinalityUpdate.ts`

```typescript
export function validateLightClientFinalityUpdate(
  config: ChainForkConfig,
  chain: IBeaconChain,
  gossipedFinalityUpdate: LightClientFinalityUpdate
): void {
  // 1. [IGNORE] No other finality_update with lower/equal finalized_header.slot already forwarded
  // 2. [IGNORE] Received after SYNC_MESSAGE_DUE_BPS time has passed since signature_slot
  // 3. [IGNORE] Matches locally computed finality update exactly
}
```

### Optimistic Update Validation
**File**: `packages/beacon-node/src/chain/validation/lightClientOptimisticUpdate.ts`

```typescript
export function validateLightClientOptimisticUpdate(
  config: ChainForkConfig,
  chain: IBeaconChain,
  gossipedOptimisticUpdate: LightClientOptimisticUpdate
): void {
  // 1. [IGNORE] No other optimistic_update with lower/equal attested_header.slot already forwarded
  // 2. [IGNORE] Received after SYNC_MESSAGE_DUE_BPS time has passed since signature_slot
  // 3. [IGNORE] Matches locally computed optimistic update exactly
}
```

### Timing check (shared)
```typescript
export function updateReceivedTooEarly(
  config: ChainForkConfig,
  clock: IClock,
  update: Pick<LightClientOptimisticUpdate, "signatureSlot">
): boolean {
  const fork = config.getForkName(update.signatureSlot);
  return (
    clock.msFromSlot(update.signatureSlot) <
    config.getSyncMessageDueMs(fork) - config.MAXIMUM_GOSSIP_CLOCK_DISPARITY
  );
}
```

**Note for light client**: These validations are designed for a **beacon node that computes its own updates** and compares gossip against local state. A light client consumer would need **different validation logic** -- it would accept updates based on cryptographic verification (sync committee signatures) rather than comparing against locally computed values.

---

## Gossip Peer Scoring

**File**: `packages/beacon-node/src/network/gossip/scoringParameters.ts`

### Score Thresholds
```typescript
export const gossipScoreThresholds: PeerScoreThresholds = {
  gossipThreshold: -4000,      // Below: reject gossip from peer
  publishThreshold: -8000,     // Below: don't publish to peer
  graylistThreshold: -16000,   // Below: ignore peer entirely
  acceptPXThreshold: 100,      // Above: accept peer exchange
  opportunisticGraftThreshold: 5,
};
```

### Topic Weights
Light client topics are **NOT included** in the scoring parameters. Only these topics have explicit scoring:
- `beacon_block` (weight 0.5)
- `beacon_aggregate_and_proof` (weight 0.5)
- `beacon_attestation` subnets (weight 1/64 each)
- `voluntary_exit` (weight 0.05)
- `proposer_slashing` (weight 0.05)
- `attester_slashing` (weight 0.05)
- `bls_to_execution_change` (weight 0.05)

This means light client topics have **no mesh message delivery scoring** -- peers won't be penalized for not delivering light client messages through the mesh. Only the general peer scoring (behavior penalty, IP colocation) applies.

### Scoring Parameters
Key scoring mechanics:
- **P1 (Time in Mesh)**: Rewards peers for being in the mesh longer (max 1 hour credit)
- **P2 (First Message Deliveries)**: Rewards peers that deliver messages first
- **P3 (Mesh Message Deliveries)**: Penalizes peers not delivering enough messages in mesh (only for scored topics)
- **P4 (Invalid Messages)**: Penalizes peers sending invalid messages
- **P6 (IP Colocation)**: Penalizes multiple peers from same IP (threshold: 3)
- **P7 (Behavior Penalty)**: General bad behavior penalty

---

## GossipSub Configuration Parameters

**File**: `packages/beacon-node/src/network/gossip/gossipsub.ts` (line 102-143)

| Parameter | Value | Notes |
|-----------|-------|-------|
| `globalSignaturePolicy` | `StrictNoSign` | No message signatures (Eth2 spec) |
| `D` (mesh target) | 8 | Target mesh peers per topic |
| `Dlo` (mesh minimum) | 6 | Minimum mesh peers before grafting |
| `Dhi` (mesh maximum) | 12 | Maximum mesh peers before pruning |
| `Dlazy` | 6 | Lazy peers for gossip |
| `heartbeatInterval` | 700ms | Per Eth2 spec |
| `fanoutTTL` | 60s | How long to remember fanout peers |
| `mcacheLength` | 6 | Message cache length (heartbeats) |
| `mcacheGossip` | 3 | Heartbeats to gossip about |
| `seenTTL` | 2 epochs | How long to remember seen messages |
| `gossipsubIWantFollowupMs` | 12s | Extended from default 3s for I/O lag |
| `asyncValidation` | true | Hold messages pending validation |
| `maxOutboundBufferSize` | 16MB | Max buffer per peer |
| `batchPublish` | true | Serialize once, send to all |
| `floodPublish` | true (default) | Publish to all mesh+topic peers |
| `idontwantMinDataSize` | 16829 | Min size to send IDONTWANT |

---

## Publishing Messages

**File**: `packages/beacon-node/src/network/network.ts`

### Light Client Publishing Flow

```typescript
async publishLightClientFinalityUpdate(update: LightClientFinalityUpdate): Promise<number> {
  const epoch = computeEpochAtSlot(update.signatureSlot);
  const boundary = this.config.getForkBoundaryAtEpoch(epoch);
  return this.publishGossip<GossipType.light_client_finality_update>(
    {type: GossipType.light_client_finality_update, boundary},
    update
  );
}
```

### Internal publish pipeline
1. `publishGossip()` serializes object to SSZ bytes
2. `NetworkCore.publishGossip()` calls `Eth2Gossipsub.publish(topicStr, messageData)`
3. `DataTransformSnappy.outboundTransform()` compresses with Snappy
4. GossipSub wraps in protobuf and sends to mesh peers

### Timing
Light client updates are published after `SYNC_MESSAGE_DUE_BPS` time has passed in the slot, ensuring the underlying sync committee messages have had time to propagate.

**Note for light client**: A light client is a **consumer** of gossip, not a producer. It subscribes to these topics to receive updates, but does not publish to them.

---

## Fork Transitions

Handled in `NetworkCore.onEpoch()`:

1. **Pre-fork**: Subscribe to new fork topics `FORK_EPOCH_LOOKAHEAD` epochs before the fork activates
2. **At fork**: Both old and new fork topics are active
3. **Post-fork**: Unsubscribe from old fork topics after transition

The fork digest in the topic string changes with each fork, so topics for different forks are distinct:
```
/eth2/{altair_digest}/light_client_finality_update/ssz_snappy    (altair)
/eth2/{bellatrix_digest}/light_client_finality_update/ssz_snappy (bellatrix)
```

---

## Dependencies

### External packages
| Package | Purpose |
|---------|---------|
| `@chainsafe/libp2p-gossipsub` | Core GossipSub protocol implementation |
| `@chainsafe/snappy-wasm` | Snappy compression/decompression (WASM) |
| `@chainsafe/as-sha256` | SHA256 for message ID calculation |
| `xxhash-wasm` | Fast hash for message deduplication |
| `libp2p` | Core networking library |
| `@libp2p/interface` | libp2p type definitions |

### Internal packages
| Package | Purpose |
|---------|---------|
| `@lodestar/config` | `BeaconConfig`, `ForkDigestContext`, `ForkBoundary` |
| `@lodestar/types` | SSZ type definitions (`LightClientFinalityUpdate`, etc.) |
| `@lodestar/params` | Constants (`SLOTS_PER_EPOCH`, `ForkSeq`, `ForkName`) |
| `@lodestar/state-transition` | `computeCommitteeCount` (used in scoring) |
| `@lodestar/utils` | `intToBytes`, `Logger` |

---

## Code Examples

### Example 1: Subscribing to light client topics
```typescript
import {GossipType, GossipTopic} from "./gossip/interface.js";

// Subscribe to both light client topics for current fork
const boundary = config.getForkBoundaryAtEpoch(currentEpoch);

gossipsub.subscribeTopic({
  type: GossipType.light_client_finality_update,
  boundary,
});
gossipsub.subscribeTopic({
  type: GossipType.light_client_optimistic_update,
  boundary,
});
```

### Example 2: Handling incoming gossip messages
```typescript
// In the beacon node, gossip messages flow through NetworkProcessor:
// 1. Eth2Gossipsub emits pendingGossipsubMessage event
// 2. NetworkProcessor queues message
// 3. Handler is called with deserialized data

// For light client, the handler would be simpler:
function onLightClientFinalityUpdate(data: Uint8Array, topic: GossipTopic): void {
  const sszType = getGossipSSZType(topic);
  const update = sszType.deserialize(data) as LightClientFinalityUpdate;
  // Verify sync committee signature
  // Update local light client state
}
```

### Example 3: Creating the Eth2Gossipsub instance
```typescript
import {Eth2Gossipsub} from "./gossip/gossipsub.js";

const gossipsub = new Eth2Gossipsub(
  {
    gossipsubD: 8,
    gossipsubDLow: 6,
    gossipsubDHigh: 12,
    disableLightClientServer: false,
  },
  {
    networkConfig,
    libp2p,
    logger,
    metricsRegister: null,
    eth2Context: { activeValidatorCount: 500000, currentSlot: 100, currentEpoch: 3 },
    peersData,
    events,
  }
);
```

### Example 4: Topic string construction
```typescript
import {stringifyGossipTopic} from "./gossip/topic.js";
import {GossipType} from "./gossip/interface.js";

const topicStr = stringifyGossipTopic(config, {
  type: GossipType.light_client_finality_update,
  boundary: config.getForkBoundaryAtEpoch(currentEpoch),
});
// Result: "/eth2/4a26c58b/light_client_finality_update/ssz_snappy"
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/beacon-node/src/network/gossip/gossipsub.ts` | `Eth2Gossipsub` class, GossipSub wrapper |
| `packages/beacon-node/src/network/gossip/interface.ts` | `GossipType` enum, all type definitions |
| `packages/beacon-node/src/network/gossip/topic.ts` | `GossipTopicCache`, topic stringify/parse, `getGossipSSZType` |
| `packages/beacon-node/src/network/gossip/encoding.ts` | `DataTransformSnappy`, message ID functions |
| `packages/beacon-node/src/network/gossip/constants.ts` | `MESSAGE_DOMAIN_VALID_SNAPPY`, default encoding |
| `packages/beacon-node/src/network/gossip/scoringParameters.ts` | Peer score params, thresholds |
| `packages/beacon-node/src/network/gossip/metrics.ts` | Gossip-specific metrics |
| `packages/beacon-node/src/chain/validation/lightClientFinalityUpdate.ts` | Finality update validation |
| `packages/beacon-node/src/chain/validation/lightClientOptimisticUpdate.ts` | Optimistic update validation |
| `packages/beacon-node/src/network/processor/gossipHandlers.ts` | All gossip message handlers |
| `packages/beacon-node/src/network/network.ts` | `publishLightClientFinalityUpdate/OptimisticUpdate` |
| `packages/beacon-node/src/network/core/networkCore.ts` | Topic subscription management, fork transitions |
