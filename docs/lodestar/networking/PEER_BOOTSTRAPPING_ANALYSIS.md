# Beacon Node Peer Bootstrapping Analysis

This document analyzes how Lodestar beacon node handles peer bootstrapping, including Status and Metadata exchange, and the validations performed during connection establishment.

## Connection Flow Overview

```
┌─ libp2p connection:open event
│
├─1. onLibp2pPeerConnect() [peerManager.ts:702]
│   ├─ Check connection status "open"
│   ├─ Create PeerData with relevantStatus=Unknown
│   └─ Start identify protocol async (non-blocking)
│
├─2. IF OUTBOUND CONNECTION
│   ├─ requestPing(peer) → triggers metadata request if seqNumber changed
│   └─ requestStatus(peer, localStatus) → assertPeerRelevance()
│
├─3. IF INBOUND CONNECTION
│   └─ Wait up to 15s for peer to send STATUS first
│
└─4. assertPeerRelevance() validates peer
    ├─ PASS → tag as relevant, emit NetworkEvent.peerConnected
    └─ FAIL → send GOODBYE, disconnect, apply 240-min cool-down
```

## Status Message Exchange

### When Status is Exchanged

| Trigger | Timing | Reference |
|---------|--------|-----------|
| Outbound connection | Immediate | [peerManager.ts:745](../../../beacon-node/src/network/peers/peerManager.ts#L745) |
| Inbound connection | After receiving peer's STATUS or 15s grace period | [peerManager.ts:728](../../../beacon-node/src/network/peers/peerManager.ts#L728) |
| Periodic refresh | Every 5 minutes (300s) | [peerManager.ts:42](../../../beacon-node/src/network/peers/peerManager.ts#L42) |
| Metadata custody change | Immediately after metadata update | [peerManager.ts:366-368](../../../beacon-node/src/network/peers/peerManager.ts#L366-L368) |
| Sync reaches target | Batch re-status all peers | [peerManager.ts:274-283](../../../beacon-node/src/network/peers/peerManager.ts#L274-L283) |

### Status Validations (assertPeerRelevance)

Located in [assertPeerRelevance.ts:25-81](../../../beacon-node/src/network/peers/utils/assertPeerRelevance.ts#L25-L81):

#### 1. Fork Digest Check
```typescript
if (!ssz.ForkDigest.equals(local.forkDigest, remote.forkDigest)) {
  return IrrelevantPeerCode.INCOMPATIBLE_FORKS;
}
```
- **Purpose**: Ensure peers are on the same network/fork
- **Cost**: Low (SSZ comparison)

#### 2. Clock Synchronization Check
```typescript
const dominated = remote.headSlot - Math.max(currentSlot, 0);
if (dominated > FUTURE_SLOT_TOLERANCE) {  // FUTURE_SLOT_TOLERANCE = 1
  return IrrelevantPeerCode.DIFFERENT_CLOCKS;
}
```
- **Purpose**: Detect genesis time mismatch or clock skew
- **Tolerance**: Only 1 slot (~12 seconds) into the future
- **Cost**: Very low (arithmetic)

#### 3. Finalized Checkpoint Validation (Deep Dive)

This is the most complex check. Let's break it down step by step.

**Terminology:**
- **`local`** = OUR Status message (what we would send to peers)
- **`remote`** = THEIR Status message (what the peer sent us)
- **Zero root** = `0x0000000000000000000000000000000000000000000000000000000000000000` (32 bytes of zeros)
  - Indicates "no finalization yet" (genesis epoch before first finality, or very early chain)
  - Used as a sentinel value meaning "nothing to compare"

**The actual code** ([assertPeerRelevance.ts:52-71](../../../beacon-node/src/network/peers/utils/assertPeerRelevance.ts#L52-L71)):

```typescript
if (
  remote.finalizedEpoch <= local.finalizedEpoch &&
  !isZeroRoot(remote.finalizedRoot) &&
  !isZeroRoot(local.finalizedRoot)
) {
  const remoteRoot = remote.finalizedRoot;
  const expectedRoot = remote.finalizedEpoch === local.finalizedEpoch ? local.finalizedRoot : null;

  if (expectedRoot !== null && !ssz.Root.equals(remoteRoot, expectedRoot)) {
    return { code: IrrelevantPeerCode.DIFFERENT_FINALIZED, ... };
  }
}
// Note: Accept request status finalized checkpoint in the future
return null;
```

**Breaking down the conditions:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ OUTER CONDITION: remote.finalizedEpoch <= local.finalizedEpoch              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Case A: Peer is AHEAD of us (remote epoch > local epoch)                   │
│  ─────────────────────────────────────────────────────────────              │
│  Example: We're at epoch 100, peer claims epoch 150                         │
│  Result: SKIP entire check, ACCEPT peer                                     │
│  Rationale: We can't verify their future finalized state                    │
│             They might be honest (we're behind) or lying (we can't know)    │
│             Let them try to sync - if lying, it will fail later             │
│                                                                             │
│  Case B: Peer is AT or BEHIND us (remote epoch <= local epoch)              │
│  ─────────────────────────────────────────────────────────────              │
│  → Continue to inner checks...                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ZERO ROOT CHECKS: !isZeroRoot(remote) && !isZeroRoot(local)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Zero root = 0x0000...0000 (32 bytes of zeros)                              │
│  When does this happen?                                                     │
│  - Epoch 0 (genesis) before any blocks are finalized                        │
│  - A node that just started and hasn't seen finalization yet                │
│                                                                             │
│  If EITHER side has zero root: SKIP check, ACCEPT peer                      │
│  Rationale: Can't meaningfully compare "nothing" to something               │
│                                                                             │
│  Example scenarios:                                                         │
│  - We just started (our root = 0x000), peer is synced → ACCEPT              │
│  - Peer just started (their root = 0x000), we're synced → ACCEPT            │
│  - Both at genesis epoch 0 → ACCEPT (both have 0x000)                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ EPOCH COMPARISON: expectedRoot = (same epoch) ? local.root : null           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Case B1: Peer at SAME epoch as us                                          │
│  ─────────────────────────────────────────────────────────────              │
│  Example: Both at epoch 100                                                 │
│  expectedRoot = local.finalizedRoot                                         │
│  → Roots MUST match, otherwise DIFFERENT_FINALIZED                          │
│  Rationale: Same epoch = same finalized block, no ambiguity                 │
│                                                                             │
│  Case B2: Peer BEHIND us                                                    │
│  ─────────────────────────────────────────────────────────────              │
│  Example: We're at epoch 100, peer at epoch 50                              │
│  expectedRoot = null (deliberately!)                                        │
│  → NO root comparison performed, ACCEPT peer                                │
│  Rationale: See code comment below                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Summary: The Only Case We Can Prove**

The finalized checkpoint check is designed to catch only the one case that can be proven cheaply: **same epoch, different root**. If two nodes are at the same finalized epoch, there can only be one correct finalized block—so if the roots differ, they are provably on different chains.

When epochs differ, we cannot cheaply prove the peer is on a different chain. If the peer is ahead of us, we can't verify their future state. If the peer is behind us, we would need to look up "what was our finalized root at their epoch?"—which requires an expensive historical database query. The code deliberately avoids chain state access for simplicity.

The trade-off is: accept potentially-bad peers optimistically, and let sync fail naturally. If we try to sync from a peer on a different chain, block validation will catch it—parent roots won't chain correctly, state roots won't match, or signatures won't verify. Either party will disconnect. This wastes some bandwidth but maintains the same security guarantees.

**Why don't we verify peers BEHIND us?** (from code comment lines 57-60):

> NOTE: due to preferring to not access chain state here, we can't check the
> finalized root against our history. The impact of not doing check is low:
> peers that are behind us we can't confirm they are in the same chain as us.
> In the worst case they will attempt to sync from us, fail and disconnect.

**Decision matrix:**

| Our Epoch | Their Epoch | Their Root | Our Root | Result |
|-----------|-------------|------------|----------|--------|
| 100 | 150 (ahead) | any | any | ✅ ACCEPT (can't verify future) |
| 100 | 100 (same) | 0xABC | 0xABC | ✅ ACCEPT (roots match) |
| 100 | 100 (same) | 0xABC | 0xDEF | ❌ REJECT (same epoch, different root = different chain) |
| 100 | 50 (behind) | any | any | ✅ ACCEPT (don't verify history) |
| 100 | 0 | 0x000 | any | ✅ ACCEPT (zero root = skip) |
| 0 | 100 | any | 0x000 | ✅ ACCEPT (our zero root = skip) |

**Why this matters for light clients:**

Light clients DO track finality! Through `LightClientUpdate.finalized_header` and `finality_branch`, a light client knows its finalized checkpoint. This should match beacon nodes on the same chain.

What light clients DON'T have is the **LMD-GHOST head** (the optimistic/unfinalized head from fork choice). The Status message contains both:
- `finalizedEpoch` / `finalizedRoot` → Light client CAN validate this ✓
- `headSlot` / `headRoot` → Light client CANNOT validate (no fork choice)

**Light client SHOULD perform the finalized checkpoint check** - it's actually simpler than for beacon nodes because light clients don't need to worry about the "peer behind us" case (light clients are typically following head, not ahead of peers).

#### 4. PeerDAS Requirement (Fulu Fork Only)
```typescript
if (isForkPostFulu(fork) && remote.earliestAvailableSlot === undefined) {
  return IrrelevantPeerCode.NO_EARLIEST_AVAILABLE_SLOT;
}
```
- **Purpose**: Ensure Fulu peers support data availability sampling
- **Cost**: Very low (null check)

### Failed Validation Actions

When `assertPeerRelevance()` fails:
1. Mark peer as `RelevantPeerStatus.irrelevant`
2. Send `GoodByeReasonCode.IRRELEVANT_NETWORK`
3. Disconnect immediately
4. Apply 240-minute reconnection cool-down ([score.ts:72](../../../beacon-node/src/network/peers/score/score.ts#L72))

## Metadata Exchange

### When Metadata is Requested

| Trigger | Reference |
|---------|-----------|
| PING response with higher sequence number | [peerManager.ts:321-323](../../../beacon-node/src/network/peers/peerManager.ts#L321-L323) |
| Custody group count changes | [peerManager.ts:366-368](../../../beacon-node/src/network/peers/peerManager.ts#L366-L368) |

### Metadata Fields by Protocol Version

| Field | V1 (Phase0) | V2 (Altair) | V3 (Fulu) |
|-------|-------------|-------------|-----------|
| `seqNumber` | ✓ | ✓ | ✓ |
| `attnets` | ✓ | ✓ | ✓ |
| `syncnets` | | ✓ | ✓ |
| `custodyGroupCount` | | | ✓ |

### Metadata Processing

From [peerManager.ts:329-370](../../../beacon-node/src/network/peers/peerManager.ts#L329-L370):

```typescript
onMetadata(peer, metadata) {
  // Update stored metadata
  peerData.metadata = {
    seqNumber: metadata.seqNumber,
    attnets: metadata.attnets,
    syncnets: metadata.syncnets,
    custodyGroupCount: metadata.custodyGroupCount ?? CUSTODY_REQUIREMENT,
  };

  // Compute custody groups (cached until count changes)
  custodyGroups = getCustodyGroups(nodeId, custodyGroupCount);
  samplingGroups = getCustodyGroups(nodeId, samplingGroupCount);

  // If custody groups changed, re-request STATUS
  if (custodyGroupCountChanged) {
    requestStatus(peer, localStatus);
  }
}
```

**Key Observation**: Metadata is NOT validated—values are trusted at face value:
- No check that `custodyGroupCount` is within valid range
- Peer could claim any number of custody groups

## PING for Liveness

### PING Intervals

| Direction | Interval | Reference |
|-----------|----------|-----------|
| Inbound peers | Every 15 seconds | [peerManager.ts:674](../../../beacon-node/src/network/peers/peerManager.ts#L674) |
| Outbound peers | Every 20 seconds | [peerManager.ts:677](../../../beacon-node/src/network/peers/peerManager.ts#L677) |

### PING Response Handling

From [peerManager.ts:318-324](../../../beacon-node/src/network/peers/peerManager.ts#L318-L324):

```typescript
onPing(peer, seqNumber) {
  const storedSeq = peerData.metadata?.seqNumber ?? BigInt(0);
  if (seqNumber > storedSeq) {
    // Peer's metadata changed, request it
    requestMetadata(peer);
  }
}
```

## Peer Relevance States

```typescript
enum RelevantPeerStatus {
  Unknown = "unknown",      // Initial state after connection
  relevant = "relevant",    // Passed assertPeerRelevance()
  irrelevant = "irrelevant" // Failed validation, being disconnected
}
```

State transitions:
- `Unknown → relevant`: Passed all validations, peer tagged in peerStore
- `Unknown → irrelevant`: Failed validation, disconnected immediately
- `irrelevant` is terminal (peer already disconnected)

## Network Events

The `NetworkEvent.peerConnected` event is emitted ONLY after:
1. Status received
2. `assertPeerRelevance()` passes
3. Peer tagged as relevant in peerStore

This means the sync layer never sees irrelevant peers.

## Timing Constants Summary

| Constant | Value | Purpose |
|----------|-------|---------|
| `STATUS_INTERVAL_MS` | 300s (5 min) | Periodic status refresh |
| `STATUS_INBOUND_GRACE_PERIOD` | 15s | Wait for inbound peer's STATUS |
| `FUTURE_SLOT_TOLERANCE` | 1 slot | Clock sync tolerance |
| Irrelevant peer cool-down | 240 min | Time before reconnection allowed |
| PING interval (inbound) | 15s | Liveness check |
| PING interval (outbound) | 20s | Liveness check |

## Observations for Light Client Implementation

### What Light Client Must Implement

1. **STATUS Response Handler**: Must respond to STATUS requests from peers
2. **Metadata Response Handler**: Must serve our Metadata when requested
3. **PING Response Handler**: Must respond to PING with our seq_number
4. **assertPeerRelevance Logic**: Should validate peer STATUS before using them

### What Light Client Can Simplify

1. **Periodic STATUS**: May not need 5-minute refresh if only fetching data
2. **Custody Group Handling**: Not relevant unless implementing PeerDAS
3. **Peer Tagging**: Can use simpler peer tracking than peerStore tags

### Critical Validations to Keep

1. **Fork Digest**: Always validate—wrong fork = wrong network
2. **Clock Sync**: Prevents connecting to dishonest peers claiming future slots

### Validations That May Be Overkill for Light Client

1. **Finalized Checkpoint**: Light client trusts sync committee, not finality
2. **earliestAvailableSlot**: Only relevant for historical data requests

## Key Files Reference

- [peerManager.ts](../../../beacon-node/src/network/peers/peerManager.ts) - Main peer lifecycle management
- [assertPeerRelevance.ts](../../../beacon-node/src/network/peers/utils/assertPeerRelevance.ts) - Status validation logic
- [peersData.ts](../../../beacon-node/src/network/peers/peersData.ts) - Peer data structures
- [score.ts](../../../beacon-node/src/network/peers/score/score.ts) - Peer scoring and cool-downs
- [ReqRespBeaconNode.ts](../../../beacon-node/src/network/reqresp/ReqRespBeaconNode.ts) - ReqResp protocol handling

---

## The Chicken-and-Egg Problem: How Do You Validate Peers Before You're Synced?

### The Problem

To validate a peer's STATUS, you need local chain state:
- **Fork digest** → requires `genesis_validators_root` + fork version at current slot
- **Finalized checkpoint** → requires knowing your own finalized block root
- **Head slot** → requires knowing current slot (from genesis time)

But to GET chain state, you need to sync from peers. How do you connect to peers without state to validate them?

### How Beacon Nodes Solve This

Beacon nodes **always have initial state** before connecting to peers:

#### Option 1: Genesis Sync
```
Node starts with:
├─ Network config (hardcoded or from file)
│   ├─ genesis_time           → can compute current_slot
│   ├─ genesis_validators_root → can compute fork_digest
│   └─ fork_schedule          → know which fork at any slot
│
├─ Genesis state (embedded or fetched once)
│   └─ finalized_checkpoint = (epoch=0, root=genesis_block_root)
│
└─ NOW can validate peers:
    ├─ fork_digest: computable from config
    ├─ head_slot: computable from genesis_time
    └─ finalized_checkpoint: epoch 0, genesis root
```

#### Option 2: Checkpoint Sync
```
Node starts with:
├─ Network config (same as above)
│
├─ Trusted checkpoint (from CLI flag, config, or beacon API)
│   ├─ finalized_state at epoch N
│   └─ finalized_block_root
│
└─ NOW can validate peers:
    ├─ fork_digest: computable from config
    ├─ head_slot: computable from genesis_time
    └─ finalized_checkpoint: from trusted checkpoint
```

**Key insight**: The network config (genesis_time, genesis_validators_root, fork_schedule) is **static and known ahead of time**. It doesn't require syncing.

### How Light Clients Should Solve This

Light clients have the same options, but with relaxed requirements:

#### What Light Client NEEDS from Config (No Sync Required)

```typescript
// These are static per-network, can be hardcoded
const networkConfig = {
  genesis_time: 1606824023,              // Mainnet genesis
  genesis_validators_root: "0x4b363...", // Mainnet GVR
  fork_schedule: {
    ALTAIR_FORK_EPOCH: 74240,
    BELLATRIX_FORK_EPOCH: 144896,
    // ...
  }
};

// From this, light client can compute:
function getForkDigest(slot: Slot): ForkDigest {
  const fork = getForkAtSlot(slot, networkConfig.fork_schedule);
  return computeForkDigest(fork.version, networkConfig.genesis_validators_root);
}

function getCurrentSlot(): Slot {
  return Math.floor((Date.now()/1000 - networkConfig.genesis_time) / 12);
}
```

#### What Light Client Gets from Bootstrap (Requires One Fetch)

```typescript
// Fetched via LightClientBootstrap RPC or REST API
const bootstrap = {
  header: { slot: 8000000, ... },
  current_sync_committee: { pubkeys: [...], aggregate_pubkey: ... },
  current_sync_committee_branch: [...]
};

// Light client can now:
// 1. Verify bootstrap against a trusted block root
// 2. Start following sync committee updates
```

#### Light Client Peer Validation Strategy

```
BEFORE any sync (just config):
├─ CAN validate fork_digest ✓ (computed from static config)
├─ CAN validate head_slot ✓ (computed from genesis_time)
├─ CANNOT validate finalized_checkpoint ✗ (need bootstrap first)
└─ CAN validate finalized_checkpoint AFTER bootstrap ✓

AFTER bootstrap/sync:
├─ CAN validate fork_digest ✓
├─ CAN validate head_slot (not too far in future) ✓
├─ CAN validate finalized_checkpoint ✓ (from LightClientUpdate.finalized_header)
├─ CANNOT validate head_root ✗ (no LMD-GHOST fork choice)
└─ Skip earliestAvailableSlot ← SKIP (only for historical data)

Light client assertPeerRelevance():
├─ Check fork_digest matches ← KEEP (prevents wrong network)
├─ Check head_slot not too far future ← KEEP (prevents clock attacks)
├─ Check finalized checkpoint ← KEEP (light client tracks finality!)
└─ Skip earliestAvailableSlot ← SKIP (only for historical data)
```

### Light Client Peer Validation

Light clients can reuse the same `assertPeerRelevance` logic as beacon nodes because:

1. **Fork digest** - Light client computes this from static config ✓
2. **Head slot clock check** - Light client knows current slot from genesis_time ✓
3. **Finalized checkpoint** - Light client tracks finality via `LightClientUpdate.finalized_header` ✓

The only field light clients CANNOT validate is `headRoot` (the LMD-GHOST optimistic head), but that's not checked in `assertPeerRelevance` anyway.

```typescript
// Light client can use the SAME assertPeerRelevance logic as beacon nodes!
// The finalized checkpoint check works because:
// - Light client has local.finalizedEpoch/Root from LightClientUpdate
// - Same-epoch-different-root detection works identically
// - "Peer behind us" case: accept optimistically (same as beacon node)
// - "Peer ahead of us" case: accept optimistically (same as beacon node)
```

### Bootstrap Sequence for P2P Light Client

```
1. Load network config (hardcoded or from file)
   ├─ genesis_time, genesis_validators_root, fork_schedule
   └─ NOW can compute fork_digest and current_slot

2. Start libp2p, connect to bootnodes
   └─ Can validate peers using fork_digest + head_slot only

3. Find peer that supports LightClientBootstrap protocol
   └─ Request bootstrap for a trusted block root

4. Verify bootstrap
   ├─ Check header matches trusted root
   └─ Verify sync committee branch proof

5. NOW fully operational
   └─ Can request LightClientUpdates to follow chain
```

### What This Means for Your Implementation

**You DON'T have a chicken-and-egg problem** because:

1. **Fork digest is computable from static config** - no sync needed
2. **Current slot is computable from genesis_time** - no sync needed
3. **Finalized checkpoint validation is OPTIONAL** for light clients - you trust sync committees, not finality

**Your light client can validate peers immediately** with just the network config, before fetching any chain data.

**The only "bootstrap" needed** is:
- Either a trusted block root (to fetch LightClientBootstrap)
- Or a pre-configured LightClientBootstrap object

Both can be provided via config/CLI, not requiring any peer interaction first.
