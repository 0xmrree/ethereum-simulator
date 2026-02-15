# Peer Discovery & Scoring Analysis for Light Client P2P

This document analyzes how the Lodestar beacon node discovers, scores, prioritizes, and prunes peers, with focus on what criteria are used and what adjustments are needed for the light client.

## Table of Contents

1. [Overview](#overview)
2. [Score System Architecture](#score-system-architecture)
3. [Lodestar Score (Req/Resp Behavior)](#lodestar-score-reqresp-behavior)
4. [Gossipsub Score (P1-P7)](#gossipsub-score-p1-p7)
5. [Combined Score Calculation](#combined-score-calculation)
6. [Score Thresholds and State Transitions](#score-thresholds-and-state-transitions)
7. [Score Decay Mechanics](#score-decay-mechanics)
8. [Peer Relevance Checks (Status Validation)](#peer-relevance-checks-status-validation)
9. [ENR Relevance Filtering (Discovery)](#enr-relevance-filtering-discovery)
10. [Peer Prioritization and Pruning](#peer-prioritization-and-pruning)
11. [Connection Limits and Heartbeat](#connection-limits-and-heartbeat)
12. [Reconnection Cool-Downs](#reconnection-cool-downs)
13. [Starvation Detection](#starvation-detection)
14. [Light Client Adjustments](#light-client-adjustments)
15. [Key Files Reference](#key-files-reference)

---

## Overview

The beacon node uses a multi-layered peer management system:

1. **Discovery layer** (discv5): Finds peer ENRs via UDP DHT, filters by fork relevance (verifies peer is on same Ethereum fork via `forkDigest`)
2. **Scoring layer**: Combines lodestar score (req/resp quality) and gossipsub score (mesh behavior) into a single number. Two separate scores exist because they measure different protocol layers with different misbehavior patterns
3. **Prioritization layer**: Decides which peers to keep/drop based on score, subnet coverage, duties, and connection direction
4. **Relevance layer**: Validates peers via Status exchange to confirm same chain/fork

Each peer has a single composite score that determines its state: Healthy, Disconnected, or Banned.

---

## Score System Architecture

**File**: `packages/beacon-node/src/network/peers/score/score.ts`

The `RealScore` class tracks three values per peer:

```typescript
class RealScore implements IPeerScore {
  private lodestarScore: number;     // From req/resp behavior penalties
  private gossipScore: number;       // From gossipsub P1-P7 parameters
  private ignoreNegativeGossipScore: boolean;  // Recovery grace for top-N negative peers
  private score: number;             // Final combined score
}
```

The `PeerRpcScoreStore` (`packages/beacon-node/src/network/peers/score/store.ts`) manages a `Map<PeerIdStr, IPeerScore>` for all known peers, bounded to `MAX_ENTRIES = 1000`.

---

## Lodestar Score (Req/Resp Behavior)

**File**: `packages/beacon-node/src/network/peers/score/store.ts` (lines 12-17)

The lodestar score is modified by `PeerAction` penalties applied when peers misbehave during req/resp interactions:

| PeerAction | Score Delta | ~Occurrences to Ban | Description |
|------------|-------------|---------------------|-------------|
| `Fatal` | -200 | 1 | Immediate ban (clamped to MIN_SCORE) |
| `LowToleranceError` | -10 | ~5 | Intolerable behavior |
| `MidToleranceError` | -5 | ~10 | Sometimes tolerable |
| `HighToleranceError` | -1 | ~50 | Frequently tolerable |

### What Triggers Each Action

**File**: `packages/beacon-node/src/network/reqresp/score.ts` (lines 22-70)

| Error Condition | Method Context | Action |
|----------------|----------------|--------|
| `INVALID_REQUEST` | Any | LowToleranceError |
| `INVALID_RESPONSE_SSZ` | Any | LowToleranceError |
| `SSZ_OVER_MAX_SIZE` | Any | LowToleranceError |
| `SERVER_ERROR` | Any | MidToleranceError |
| `UNKNOWN_ERROR_STATUS` | Any | HighToleranceError |
| `DIAL_TIMEOUT` | Ping | Fatal |
| `DIAL_TIMEOUT` | Other | LowToleranceError |
| `DIAL_ERROR` + protocol selection failed | Ping | Fatal |
| `DIAL_ERROR` | Other | LowToleranceError |
| `TTFB_TIMEOUT` | Ping, Status, Metadata | LowToleranceError |
| `TTFB_TIMEOUT` | BeaconBlocksByRange/Root | MidToleranceError |
| `TTFB_TIMEOUT` | Other (including LC methods) | null (no penalty) |
| `RESP_TIMEOUT` | Same as TTFB | Same as TTFB |
| `ERR_UNSUPPORTED_PROTOCOL` | Ping | Fatal |
| `ERR_UNSUPPORTED_PROTOCOL` | Status, Metadata | LowToleranceError |
| `ERR_UNSUPPORTED_PROTOCOL` | Other | null (no penalty) |
| Rate limit exceeded | Any | Fatal |

**Key observation**: Light client methods (Bootstrap, UpdatesByRange, FinalityUpdate, OptimisticUpdate) return `null` for timeouts and unsupported protocol errors. This is intentional -- not all peers serve light client data, so it's unfair to penalize them for not responding.

**Note**: This lenient policy applies more broadly than just LC methods. `ERR_UNSUPPORTED_PROTOCOL` returns `null` (no penalty) for ANY method except Ping/Status/Metadata, because many req/resp features are considered optional serving. Only the three core methods (Ping, Status, Metadata) are mandatory - everything else is "nice to have" from the beacon node's perspective. This makes sense for a general-purpose beacon node, but light clients may want stricter penalties for LC methods specifically (see Light Client Adjustments section).

---

## Gossipsub Score (P1-P7)

**File**: `packages/beacon-node/src/network/gossip/scoringParameters.ts`

Gossipsub maintains its own peer scoring with 7 parameters. This score is computed internally by `@chainsafe/libp2p-gossipsub` and read by lodestar.

**About Gossipsub Scoring**: The P1-P7 scoring system is an industry standard from the libp2p/gossipsub specification. The specific parameter values and thresholds used here are Ethereum consensus-specific tuning. The scoring happens automatically within the gossipsub protocol implementation.

**What is a "mesh"?** In gossipsub, not all connected peers participate in gossiping for every topic. The "mesh" for a topic is the subset of peers you're actively exchanging messages with for that specific topic. Mesh size is typically D=8 peers per topic. Time in mesh (P1) rewards peers for stable, long-lived mesh participation.

### Parameters

| Parameter | What It Measures | Impact |
|-----------|-----------------|--------|
| **P1**: Time in Mesh | How long peer has been in topic mesh | Positive (max +10) |
| **P2**: First Message Deliveries | Peer delivers messages before others | Positive (max +40) |
| **P3**: Mesh Message Deliveries | Peer delivers enough messages in mesh | Negative if below threshold |
| **P4**: Invalid Messages | Peer sends invalid messages | Heavy negative |
| **P5**: App-Specific | Custom application score | Weight=1, not used by lodestar |
| **P6**: IP Colocation | Multiple peers from same IP | Negative if >3 peers/IP (gossip-only because gossipsub mesh is vulnerable to Sybil attacks; req/resp is point-to-point so IP matters less) |
| **P7**: Behavior Penalty | General protocol misbehavior | Quadratic negative |

### Topic Weights (lines 21-37)

Gossipsub computes a per-topic score for each peer based on their behavior in that topic's mesh (using P1-P7 parameters). These per-topic scores are then weighted and summed to produce a single `gossipScore` per peer.

**How it works**:
```
gossipScore = Σ(topicScore[i] * topicWeight[i]) for all topics
```

For example, if a peer has:
- `beacon_block` topic score: +100, weight: 0.5 → contributes +50
- `beacon_attestation_5` topic score: -20, weight: 0.016 → contributes -0.32
- Sum = +49.68 (this becomes the peer's `gossipScore`)

Only certain topics are weighted in scoring. Light client topics have **no explicit weight**:

| Topic | Weight | Has Mesh Scoring (P3)? |
|-------|--------|------------------------|
| `beacon_block` | 0.5 | Yes |
| `beacon_aggregate_and_proof` | 0.5 | Yes |
| `beacon_attestation` (per subnet) | 1/64 (~0.016) | Yes |
| `voluntary_exit` | 0.05 | No |
| `proposer_slashing` | 0.05 | No |
| `attester_slashing` | 0.05 | No |
| `bls_to_execution_change` | 0.05 | No |
| `light_client_finality_update` | **Not scored** | No |
| `light_client_optimistic_update` | **Not scored** | No |

### Gossipsub Score Thresholds (lines 43-49)

```typescript
gossipThreshold: -4000       // Below: stop gossiping to peer
publishThreshold: -8000      // Below: stop publishing to peer
graylistThreshold: -16000    // Below: ignore peer entirely
acceptPXThreshold: 100       // Above: accept peer exchange
opportunisticGraftThreshold: 5
```

---

## Combined Score Calculation

**File**: `packages/beacon-node/src/network/peers/score/score.ts` (lines 148-160)

```
finalScore = lodestarScore + weightedGossipScore
```

The weighting logic:

1. If `lodestarScore <= -60` (`MIN_LODESTAR_SCORE_BEFORE_BAN`): gossip score is **ignored entirely**, peer is banned based on lodestar score alone
2. If `gossipScore >= 0`: `weightedGossipScore = gossipScore * GOSSIPSUB_POSITIVE_SCORE_WEIGHT`
3. If `gossipScore < 0` AND `!ignoreNegativeGossipScore`: `weightedGossipScore = gossipScore * GOSSIPSUB_NEGATIVE_SCORE_WEIGHT`
4. If `gossipScore < 0` AND `ignoreNegativeGossipScore`: `weightedGossipScore = 0`

### Weight Values

**File**: `packages/beacon-node/src/network/peers/score/constants.ts` (lines 32-34)

```typescript
GOSSIPSUB_NEGATIVE_SCORE_WEIGHT = (MIN_SCORE_BEFORE_DISCONNECT + 1) / graylistThreshold
                                = (-20 + 1) / -16000
                                = -19 / -16000
                                ≈ 0.00119
GOSSIPSUB_POSITIVE_SCORE_WEIGHT = 0.00119  // Same as negative
```

**Design intent**: Negative gossipsub scores alone can NEVER cause disconnection. Even the worst gossipsub score (-16000) only contributes ~-19 to the final score, which is just above the disconnect threshold (-20). This prevents gossipsub scoring bugs from mass-disconnecting peers.

**Why this asymmetry?** Gossipsub scoring is complex (7 parameters, mesh dynamics, topic weights) and more prone to bugs or edge cases. Req/resp scoring is simpler and more trustworthy (direct request/response interactions). By making the gossip weight tiny (0.00119), the system ensures that even if gossipsub goes haywire and gives everyone -16000, it won't nuke your entire peer set. Req/resp misbehavior (invalid responses, timeouts on critical methods) is more reliable evidence of a bad peer, so it's allowed to cause bans/disconnects.

### Negative Gossip Score Grace Period

**File**: `packages/beacon-node/src/network/peers/score/utils.ts` (lines 14-37)

The top N peers with mildly negative gossip scores (`-1000 < score < 0`) have their negative gossip score **ignored** to allow recovery:

- N = `ALLOWED_NEGATIVE_GOSSIPSUB_FACTOR * targetPeers` = `0.1 * 200 = 20` peers
- Threshold: `negativeGossipScoreIgnoreThreshold = -1000`
- Peers are sorted by gossip score descending; the best N negative peers get the grace

---

## Score Thresholds and State Transitions

**File**: `packages/beacon-node/src/network/peers/score/constants.ts`

| Constant | Value | Meaning |
|----------|-------|---------|
| `DEFAULT_SCORE` | 0 | New peer starting score |
| `MAX_SCORE` | 100 | Maximum possible score |
| `MIN_SCORE` | -100 | Minimum possible score |
| `MIN_SCORE_BEFORE_DISCONNECT` | -20 | Peer gets disconnected |
| `MIN_SCORE_BEFORE_BAN` | -50 | Peer gets banned |
| `MIN_LODESTAR_SCORE_BEFORE_BAN` | -60 | Lodestar-only ban (ignoring gossip) |
| `SCORE_THRESHOLD` | 1 | Scores with |value| < 1 are pruned from memory |

### State Machine

**File**: `packages/beacon-node/src/network/peers/score/utils.ts` (lines 5-9)

```
score > -20     → Healthy     (connections + messages allowed)
-50 < score ≤ -20 → Disconnected (disconnect, reconnection allowed for persistent peers)
score ≤ -50     → Banned       (no connections until score decays)
```

---

## Score Decay Mechanics

**File**: `packages/beacon-node/src/network/peers/score/score.ts` (lines 86-101)
**File**: `packages/beacon-node/src/network/peers/score/constants.ts` (lines 18-22)

| Parameter | Value |
|-----------|-------|
| Half-life | 10 minutes (`SCORE_HALFLIFE_MS = 600,000`) |
| Decay constant | `-ln(2) / 600000 ≈ -0.00000116` |
| Cool-down before decay (banned peers) | 30 minutes (`COOL_DOWN_BEFORE_DECAY_MS`) |

### Decay Formula
```
decayFactor = e^(HALFLIFE_DECAY_MS * timeSinceLastUpdate)
newScore = lodestarScore * decayFactor
```

Decay is exponential and applies equally to positive and negative scores. After banning (score drops to ≤ -50), the peer must wait 30 minutes before decay begins. Then it takes roughly:
- ~10 min to go from -50 → -25
- ~20 min to go from -50 → -12.5
- ~30 min to reach above disconnect threshold

So a banned peer recovers after approximately **50-60 minutes** total (30 min cool-down + ~20 min decay).

**The decay model philosophy**: Bad behavior immediately decreases score. Then time heals all wounds exponentially - scores drift back toward zero with a 10-minute half-life. If a peer repeatedly misbehaves, the score keeps getting pushed down faster than it can decay back up. This allows temporary issues (network hiccups, restarts) to recover while persistent bad actors stay banned.

---

## Peer Relevance Checks (Status Validation)

**File**: `packages/beacon-node/src/network/peers/utils/assertPeerRelevance.ts`

After connecting, peers exchange Status messages containing:
- `forkDigest` - which fork the peer is on
- `finalizedRoot` - peer's finalized checkpoint root
- `finalizedEpoch` - peer's finalized checkpoint epoch
- `headRoot` - peer's chain head block root
- `headSlot` - peer's chain head slot number
- `earliestAvailableSlot` - (Fulu+ fork only) oldest historical slot peer has available

These values are then validated for relevance. **Status validation is a binary pass/fail check that happens BEFORE scoring matters**. If validation fails, the peer is immediately disconnected with a Goodbye message - no score penalties are applied because the peer is fundamentally incompatible. Score only applies to peers you decide to keep after they pass status validation.

### Validation Checks

| Check | Condition | Result |
|-------|-----------|--------|
| Fork compatibility | `local.forkDigest !== remote.forkDigest` | `INCOMPATIBLE_FORKS` → disconnect |
| Clock agreement | `remote.headSlot > currentSlot + 1` (peer is far in future) | `DIFFERENT_CLOCKS` → disconnect |
| Finalized agreement | Same finalized epoch, different root | `DIFFERENT_FINALIZED` → disconnect |
| Earliest available slot (Fulu+) | Missing `earliestAvailableSlot` when required | `NO_EARLIEST_AVAILABLE_SLOT` → disconnect |

**Note**: Peers with a finalized epoch **ahead** of ours are accepted (we can't verify their checkpoint).

---

## ENR Relevance Filtering (Discovery)

**File**: `packages/beacon-node/src/network/discv5/utils.ts`

Before dialing a discovered peer, its ENR is checked:

| Check | What It Verifies | Result if Failed |
|-------|-----------------|------------------|
| TCP address present | `enr.getLocationMultiaddr("tcp")` exists | `no_tcp` → skip |
| eth2 field present | `enr.kvs.get("eth2")` exists | `no_eth2` → skip |
| Fork digest known | `forkDigest2ForkBoundary()` succeeds | `unknown_forkDigest` → skip |
| Current fork match | Fork is current **or previous** | `current_fork_mismatch` → skip |

Only ENRs passing all four checks are considered `relevant` and eligible for dialing.

**Fork boundary grace period**: The "current or previous fork" check (line 4 above) provides a grace period during fork transitions. When a new fork activates, you'll still accept peers advertising the previous fork's digest temporarily. This prevents mass disconnections at fork boundaries as the network gradually upgrades.

---

## Peer Prioritization and Pruning

**File**: `packages/beacon-node/src/network/peers/utils/prioritizePeers.ts`

When `connectedPeers > targetPeers`, the pruning algorithm runs:

### Pruning Priority (what gets disconnected first)

**Step 0: Sort peers for pruning** (`sortPeersToPrune`, lines 510-529)

Peers are sorted ascending (first in list = most likely to prune):
1. Shuffle (break ties randomly)
2. Sort by duty count (ascending) -- peers with active duties survive
3. Sort by status score (peers FAR_AHEAD kept when starved)
4. Sort by long-lived subnet count (ascending) -- more subnets = more valuable
5. Sort by peer score (ascending) -- higher score = more valuable

### Peers Exempt from Pruning (lines 358-381)

- Has active attestation/sync committee duties (meaning: YOU have validator duties, and this peer is on subnets YOU need for those duties. Note: block proposers aren't tracked separately because they publish to the global `beacon_block` topic, not subnet-specific topics)
- Is FAR_AHEAD when node is starved for data
- Is an outbound peer within the outbound ratio (10%)

### Pruning Steps

1. **No long-lived subnets** (`NO_LONG_LIVED_SUBNET`, lines 393-400): Peers without any `attnets` or `syncnets` bits set are pruned first
   - `attnets`: 64-bit ENR field indicating which attestation subnets (0-63) the peer subscribes to
   - `syncnets`: 4-bit ENR field indicating which sync committee subnets (0-3) the peer subscribes to
2. **Low score** (`LOW_SCORE`, lines 402-414): Peers with score < -2 are pruned
3. **Too grouped on subnet** (`TOO_GROUPED_SUBNET`, lines 416-475): If one subnet has too many peers (> `TARGET_SUBNET_PEERS = 6`), remove peers from the over-represented subnet
4. **Find better peers** (`FIND_BETTER_PEERS`, lines 477-500): Prune remaining lowest-priority peers to reach target

### Key Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `TARGET_SUBNET_PEERS` | 6 | Target peers per subnet |
| `MIN_SYNC_COMMITTEE_PEERS` | 2 | Floor for sync committee subnets |
| `LOW_SCORE_TO_PRUNE_IF_TOO_MANY_PEERS` | -2 | Score threshold for pruning |
| `PEERS_TO_CONNECT_OVERSHOOT_FACTOR` | 3 | Overshoot dial attempts (low success rate) |
| `OUTBOUND_PEERS_RATIO` | 0.1 | Keep at least 10% outbound (see explanation below) |

### Outbound vs Inbound Connections

**Outbound**: You initiated the connection (you dialed them)
**Inbound**: They initiated the connection (they dialed you)

**Why this matters**:
- Outbound connections prove you can actively discover and reach peers (NAT traversal works, discovery is functioning)
- If you only accept inbound connections, you might be passive/isolated
- Attack mitigation: all inbound connections could theoretically come from one adversary controlling many IPs
- Maintaining 10% outbound ensures you're actively participating in peer discovery, not just accepting whatever connects to you

---

## Connection Limits and Heartbeat

**Note on terminology**: "Connected peers" refers to active libp2p connections (TCP streams where you're exchanging messages). This is completely different from the discv5 routing table, which is a DHT for peer discovery containing thousands of peer records (ENRs) you've discovered but aren't necessarily connected to. Discovery finds candidates; connection limits control how many you actually connect to.

### Connection Limits

| Parameter | Default | Description |
|-----------|---------|-------------|
| `targetPeers` | 200 | Desired peer count |
| `maxPeers` | 210 | Hard limit (room for inbound) |
| `targetGroupPeers` | 6 | Per custody group (Fulu+) |

### Heartbeat Timing

**File**: `packages/beacon-node/src/network/peers/peerManager.ts` (lines 36-49)

| Interval | Value | What Happens |
|----------|-------|--------------|
| Main heartbeat | 30 seconds | Score decay, ban/disconnect, prioritize, prune, discover |
| Ping outbound | 20 seconds | Send ping to outbound peers |
| Ping inbound | 15 seconds | Send ping to inbound peers |
| Status interval | 5 minutes | Exchange status with peers |
| Status inbound grace | 15 seconds | Grace period for new inbound peers before status check |
| Check ping/status | 10 seconds | Check if pings/status are due |

### Heartbeat Actions (in order)

1. Decay all peer scores
2. Ban peers with score ≤ -50, disconnect peers with score ≤ -20
3. Determine if node is "starved" for data
4. Run prioritization algorithm (who to keep/drop)
5. Disconnect excess peers
6. Issue discovery queries if below target
7. Prune leaked connections (connected but not tracked)

---

## Reconnection Cool-Downs

**File**: `packages/beacon-node/src/network/peers/score/score.ts` (lines 56-78)

When a peer disconnects (via Goodbye message), a cool-down prevents immediate reconnection. The Goodbye message contains a `reason` field in its body indicating why the peer is disconnecting:

| Goodbye Reason | Cool-Down | Notes |
|----------------|-----------|-------|
| `BANNED` | None (score decay handles it) | Score must decay from ≤ -50 |
| `SCORE_TOO_LOW` | None (score decay handles it) | Score must decay from ≤ -20 |
| `INBOUND_DISCONNECT` | 5 minutes | Peer disconnected from us |
| `TOO_MANY_PEERS` | 5 minutes | Peer at capacity |
| `ERROR` | 60 minutes | General error |
| `CLIENT_SHUTDOWN` | 60 minutes | Peer shutting down |
| `IRRELEVANT_NETWORK` | 240 minutes (4 hours) | Wrong network/fork |

During cool-down, `isCoolingDown()` returns true and the peer won't be dialed.

---

## Starvation Detection

**File**: `packages/beacon-node/src/network/peers/peerManager.ts`

The beacon node detects when it's "starved" for data:

```
starved = (lastStatus.headSlot === currentStatus.headSlot)
          AND (currentSlot - headSlot > STARVATION_THRESHOLD_SLOTS)

STARVATION_THRESHOLD_SLOTS = 2 epochs = 64 slots
STARVATION_PRUNE_RATIO = 0.05
```

When starved:
- Peers that are FAR_AHEAD (their head slot is much ahead of yours) become exempt from pruning because they might have the blocks/data you're missing
- An additional 5% of target peers are pruned to make room for potentially better peers who can help you sync

**Starvation in pruning context**: When YOU are starved (stuck, not syncing), you want to protect peers that are ahead of you rather than pruning them. The FAR_AHEAD status check during pruning prevents accidentally disconnecting from peers who have the data you desperately need.

---

## Subnets Explained

**What are subnets and why do they exist?**

Ethereum consensus uses subnets as a scaling mechanism to reduce bandwidth requirements. Without subnets, every beacon node would need to receive and validate ALL attestations from ALL 64 committees, which is prohibitively expensive.

**How subnets work**:
- There are 64 attestation subnets (`beacon_attestation_0` through `beacon_attestation_63`)
- Each attestation committee is assigned to one subnet
- Validators only subscribe to the subnet(s) their committee is assigned to
- Instead of gossiping all attestations globally, they're sharded across 64 separate gossip topics
- This reduces each node's bandwidth by ~64x for attestation traffic

**Additional subnet types**:
- 4 sync committee subnets for sharding sync committee messages
- Custody subnets (PeerDAS/Fulu) for data availability sampling

**Where subnet logic exists**:
- Discovery layer: ENR contains `attnets` and `syncnets` bitfields advertising which subnets a peer subscribes to
- Gossipsub layer: Actual topic subscriptions like `beacon_attestation_5`
- Peer management: Pruning algorithm tries to maintain coverage across subnets you care about

**Why light clients don't need subnets**:
- Light clients don't validate attestations
- They only need the global topics: `light_client_finality_update` and `light_client_optimistic_update`
- No subnet subscriptions = no subnet tracking needed in peer management

---

## Light Client Adjustments

### What Changes for the Light Client

#### 1. Drastically Reduced Peer Targets

The beacon node targets 200 peers because it needs coverage across 64+ attestation subnets, sync committee subnets, and custody groups. With `TARGET_SUBNET_PEERS = 6` per subnet and 64 attestation subnets alone, you need substantial peer count for good subnet coverage. The 200 target could theoretically be lower, but it works well for beacon nodes given their subnet requirements.

The light client subscribes to **zero subnets** and only 2 global gossip topics.

**Recommendation**: Target 10-30 peers. This provides enough redundancy for gossip mesh formation (D=8) and req/resp diversity without wasting resources. The target should be configurable (not hardcoded to 200).

#### 2. Simplified Pruning -- No Subnet Logic

The beacon node's pruning algorithm (`prioritizePeers`) is heavily focused on subnet coverage: keeping peers with valuable `attnets`/`syncnets` bits, balancing per-subnet counts, protecting dutied peers. None of this applies to the light client.

**Recommendation**: Replace the subnet-based pruning with a simpler algorithm:
- Prune peers with low score first
- Maintain outbound ratio (10%)
- Prune to target
- No need for subnet tracking, duty tracking, or custody group tracking

#### 3. Adjusted Scoring for Light Client Methods

The beacon node returns `null` (no penalty) for timeouts and unsupported protocol on light client methods. This makes sense for a beacon node where LC serving is optional. For the light client, these methods are its **primary purpose**, so scoring should be adjusted:

**Recommendation**:
- Timeouts on LC methods should apply `MidToleranceError` (-5) since the light client depends on these responses
- `ERR_UNSUPPORTED_PROTOCOL` for LC methods should apply `HighToleranceError` (-1) rather than `null` -- peers that can't serve LC data are less valuable
- Consider a positive signal: peers that successfully serve LC data could be preferred (though lodestar's score system is negative-only, you could track this separately for peer selection)

**Why not require LC support at connection time?** You might wonder why light clients shouldn't only connect to peers that support LC methods. The answer:
1. ENRs don't advertise LC method support - you only discover this after connecting and attempting requests
2. Gradual score-based filtering (via the penalties above) naturally deprioritizes non-LC peers over time without hard requirements
3. Some non-LC peers might still be useful for gossip topics even if they don't serve LC req/resp
4. Hard requirements at connection time would complicate discovery and potentially limit the peer pool unnecessarily

The recommended penalty adjustments above will naturally steer the light client toward LC-supporting peers without making it mandatory.

#### 4. Status Validation Differences

The beacon node's `assertPeerRelevance` checks fork digest match, clock agreement, finalized checkpoint consistency, and earliest available slot. The light client has different chain state:

**Recommendation**:
- **Fork digest**: Same check applies -- must match current fork
- **Clock agreement**: Same check applies -- peer shouldn't be far in the future
- **Finalized checkpoint**: Light client tracks finalized header from LC updates, not full fork choice. Compare using the light client's latest finalized header slot/root
- **Earliest available slot**: Not relevant for light client (it doesn't sync full blocks or historical data). This field indicates the oldest block slot a beacon node has available - important for full nodes doing historical sync, but meaningless for light clients that only track recent light client updates. Skip this check entirely for light clients.

#### 5. Simplified Gossipsub Scoring

The beacon node computes detailed topic-level gossipsub scores using active validator count, committee sizes, and expected message rates. The light client only subscribes to 2 global topics with no mesh delivery scoring.

**Recommendation**:
- Still use gossipsub peer scoring (it's handled by `@chainsafe/libp2p-gossipsub` internally)
- The weight calculation from gossip → final score can remain the same
- Don't need to compute `activeValidatorCount`-based topic scores -- use simplified defaults
- The negative gossip score ignore logic (top 10% grace) can be kept but with the smaller peer target

#### 6. Starvation Detection Differences

The beacon node detects starvation by comparing head slot progress. The light client doesn't have a "head slot" in the same sense -- it tracks the latest optimistic and finality updates.

**Recommendation**:
- Define starvation as: no new optimistic update received for > N slots (e.g., 32 slots / 1 epoch)
- When starved, increase discovery aggressiveness and relax pruning, similar to beacon node behavior

#### 7. ENR Relevance Filtering -- Unchanged

The ENR relevance checks (TCP address, eth2 field, fork digest, current fork) are fully applicable to the light client. No changes needed.

#### 8. Connection Direction Awareness -- Simplified

The beacon node carefully manages outbound vs inbound ratio. The light client should also maintain some outbound connections to avoid being isolated.

**Recommendation**: Keep `OUTBOUND_PEERS_RATIO = 0.1` or higher. With only 20 target peers, this means at least 2 outbound connections.

#### 9. Discovery Strategy -- Simplified

The beacon node's discovery prioritizes subnet-specific queries (find peers on attestation subnet 5, sync committee subnet 2, custody group 7). The light client needs none of this.

**Recommendation**:
- Run only general `findRandomNode()` queries
- No subnet-targeted discovery needed
- Consider a much simpler peer discovery module (no `PeerDiscovery` class complexity, no `RequestedSubnet` tracking)

#### 10. No Sync-Based Peer Selection

The beacon node's `peerBalancer.ts` selects peers for sync batches based on target slot, active requests, custody columns. The light client doesn't do range sync.

**Recommendation**: For LC req/resp requests (Bootstrap, UpdatesByRange, etc.), select peers by:
- Score (prefer highest)
- Random among healthy peers (avoid always hitting the same peer)
- Avoid peers that recently failed an LC request

### Summary Table

| Feature | Beacon Node | Light Client |
|---------|-------------|-------------|
| Target peers | 200 | 10-30 |
| Max peers | 210 | targetPeers + 10 |
| Subnet tracking | attnets, syncnets, custody groups | None |
| Pruning criteria | Score + subnets + duties + status | Score + outbound ratio |
| LC method timeout penalty | null (no penalty) | MidToleranceError (-5) |
| LC unsupported protocol penalty | null (no penalty) | HighToleranceError (-1) |
| Status validation | Full (fork + clock + finalized + EAS) | Fork + clock + LC finalized header |
| Gossipsub topic scoring | Per-topic weights with P3 mesh scoring | Default/minimal |
| Starvation detection | Head slot not progressing | No optimistic update for > 1 epoch |
| Discovery queries | Subnet-targeted + random | Random only |
| Sync peer selection | Batch-based, custody-aware | Score-based, random among healthy |
| Score decay half-life | 10 minutes | Same (10 minutes) |
| Ban cool-down | 30 minutes | Same (30 minutes) |
| Reconnection cool-downs | Same as beacon node | Same |

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `packages/beacon-node/src/network/peers/score/score.ts` | `RealScore` class, decay logic, gossip score integration |
| `packages/beacon-node/src/network/peers/score/store.ts` | `PeerRpcScoreStore`, action-to-score mapping |
| `packages/beacon-node/src/network/peers/score/constants.ts` | All score thresholds and constants |
| `packages/beacon-node/src/network/peers/score/interface.ts` | `ScoreState`, `PeerAction`, `IPeerScore` interfaces |
| `packages/beacon-node/src/network/peers/score/utils.ts` | `scoreToState()`, `updateGossipsubScores()` |
| `packages/beacon-node/src/network/peers/peerManager.ts` | `PeerManager`, heartbeat, connection management |
| `packages/beacon-node/src/network/peers/discover.ts` | `PeerDiscovery`, ENR caching, dial decisions |
| `packages/beacon-node/src/network/peers/utils/prioritizePeers.ts` | Pruning algorithm, subnet balancing |
| `packages/beacon-node/src/network/peers/utils/assertPeerRelevance.ts` | Status-based relevance checks |
| `packages/beacon-node/src/network/peers/client.ts` | Client detection (Lighthouse, Teku, etc.) |
| `packages/beacon-node/src/network/reqresp/score.ts` | Req/resp error → PeerAction mapping |
| `packages/beacon-node/src/network/gossip/scoringParameters.ts` | Gossipsub P1-P7 parameters and thresholds |
| `packages/beacon-node/src/network/discv5/utils.ts` | ENR relevance filtering |
| `packages/beacon-node/src/sync/range/utils/peerBalancer.ts` | Peer selection for sync batches |
