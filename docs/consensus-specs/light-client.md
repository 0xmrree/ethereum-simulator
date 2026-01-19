# ligh client - light client flow 

So the goal is a trustless way to do operations (at least read, for write technically) on chain without having to trust a single node for their view of the chain. 
Bootstrap phase - get the first pub keys:
First you get some checkpointRoot which is just a hash of a beacon block header at some checkpoint slot in the past. This root is gotten from social consensus but you already have trust in your wallet provider so the trust profile is not changing much. Then you take this root and poke a beacon node API you know about and request LightClientBootstrap message which will contain the block header, sync committee pub keys, and merkle proof of sync committee within beacon state. Then you prove your sync pub keys exist in the beacon state of your root, then verify the hash of the header equals the checkpoint, thus you trustlessly verified the public keys belonging to the checkpoint you are bootstrapping from. Even if you connected to a bad actor who wants you to believe in a fake chain with his own pub keys, he could not because he would need pre image attack the hash of his fake header (> bitcoins entire POW).
Sync phase - get to the last sync period :
Now with your trusted pub keys that are RANDAO-style chosen by the protocol, you will keep getting the next best sync attested block header 256 epochs downstream. You will move forward each sync period of 256 epochs by processing a LightClientUpdate message. To verify it you first take the attested header which is what the committee signed and verify it against the given aggregate signature - you can do this because you have your trusted public keys starting from bootstrap. The specific attested header is chosen by finding a block in the period with the best sync committee participation and latest finality advancement. Then after you verify, you have a trusted attested header which contains a beacon state root. You take this beacon state root and verify the finalized header via its merkle proof. Now you have both a new trusted finalized header and a new trusted head block. Given you will have the next sync committee in the beacon state of the attested header, you can now repeat this process until you get to the head of the chain forming a chain of proofs all the way from the checkpoint root you started with.
Note that if in a given period no blocks get 2/3 sync attestations, all light clients will break until a new checkpointRoot is given out pased that period.
Gossip phase:
Gossip phase is pretty easy to understand. Within a period you will basically have a current latest LMD GHOST head with sync committee  proof and the latest finalized header, and you will verify these as they come with your pub keys from the committee and the aggregate signatures via subscribing to topics. Then when you approach a sync period boundary you will request the same LightClientUpdate from sync phase, verify it, and update your local sync committee pub keys just like you did before, then repeat your logic for the gossip topics as new blocks come in. You want to maintain both local current LMD GHOST header and the finalized header so wallets and applications can use both depending on use cases. And of course this info is vital because you just take the execution world state root and find an RPC server soyou can verify with the EL's merkle proof. You don't have to trust the RPC, you just need to find one honest one.   (:

# How Sync Aggregates Get Included in Blocks

At each slot N, the sync committee (512 validators) creates signatures attesting to the current block (block N). These signatures are aggregated and included in the next block (block N+1).

## Timeline Within Slot N (12 second slot on mainnet)

### 0% (0s) - Block Proposed

- The proposer for slot N broadcasts their block
- This block contains the `SyncAggregate` attesting to block N-1 (signatures created during slot N-1)

### ~33% (~4s) - Sync Committee Signs (`SYNC_MESSAGE_DUE_BPS = 3333`)

- All 512 sync committee members sign the `beacon_block_root` of slot N's block
- Each member creates a `SyncCommitteeMessage` containing:
  - `slot`: current slot
  - `beacon_block_root`: the block root they're signing
  - `validator_index`: their index
  - `signature`: BLS signature over the block root
- Members broadcast to their assigned subnet (`sync_committee_{subnet_id}`)
- The 512 members are split across 4 subnets (~128 validators each)

### ~67% (~8s) - Aggregators Bundle Signatures (`CONTRIBUTION_DUE_BPS = 6667`)

- ~16 aggregators per subnet (selected probabilistically via `is_sync_committee_aggregator`)
- Each aggregator collects `SyncCommitteeMessage`s from their subnet with matching `beacon_block_root`
- They create a `SyncCommitteeContribution` containing:
  - `slot`: current slot
  - `beacon_block_root`: the signed block root
  - `subcommittee_index`: which subnet (0-3)
  - `aggregation_bits`: bitvector of which validators in the subnet participated
  - `signature`: aggregated BLS signature of all collected signatures
- Aggregators wrap this in a `SignedContributionAndProof` and broadcast to the global `sync_committee_contribution_and_proof` topic

### Slot N+1, 0% (0s) - Next Block Proposed

- The proposer for slot N+1 has collected contributions from the global topic
- They select the best contribution per subnet (most participation bits)
- They merge all 4 contributions into a single `SyncAggregate`:
  - `sync_committee_bits`: 512-bit bitvector of all participants across all subnets
  - `sync_committee_signature`: single aggregated BLS signature from all contributions
- Block N+1 is proposed containing the `SyncAggregate` in `block.body.sync_aggregate`
- This signature attests to block N's `beacon_block_root`

## Visual Timeline

```
Slot N                                          Slot N+1
├───────────┼───────────┼───────────┼───────────┤───────────...
0s          4s          8s          12s         0s
│           │           │                       │
↓           ↓           ↓                       ↓
Block N     Sync comm   Aggregators             Block N+1 proposed
proposed    signs       broadcast               (contains SyncAggregate
            Block N     contributions            attesting to Block N)
```

## Subnet Flow

```
Sync Committee (512 validators)
            │
            ▼
┌─────────────────────────────────────────────────────────────┐
│  subnet 0    │  subnet 1    │  subnet 2    │  subnet 3     │
│  (~128 vals) │  (~128 vals) │  (~128 vals) │  (~128 vals)  │
│      │       │      │       │      │       │      │        │
│      ▼       │      ▼       │      ▼       │      ▼        │
│  ~16 aggs    │  ~16 aggs    │  ~16 aggs    │  ~16 aggs     │
└──────┬───────┴──────┬───────┴──────┬───────┴──────┬────────┘
       │              │              │              │
       └──────────────┴──────┬───────┴──────────────┘
                             ▼
              Global topic: sync_committee_contribution_and_proof
                             │
                             ▼
                    Proposer (slot N+1)
                             │
                             ▼
                      SyncAggregate
                (sync_committee_bits + sync_committee_signature)
```

## Analogy to Attestations

This is analogous to how attestations work - the `attested_header` in attestations is always from a previous block, just like the `beacon_block_root` in sync aggregates is always from the previous block. You can't sign something until it exists.
