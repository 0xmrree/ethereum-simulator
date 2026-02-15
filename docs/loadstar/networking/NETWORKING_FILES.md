# Networking File Reference

Every networking file in Lodestar with descriptions, organized by directory. Each section explains what the directory does and how it relates to the light client.

---

## beacon-node/src/network/ — Top-Level

The top-level network directory contains the public facade, configuration, and shared infrastructure. `network.ts` is the main entry point that the rest of the beacon node calls into. For the light client, we'll build a simplified version of this facade — fewer methods, no worker multiplexing, just direct calls to our NetworkCore.

| File | Description |
|------|-------------|
| `network.ts` | Main facade exposing all networking methods (gossip, reqresp, peer management) to the beacon node |
| `interface.ts` | INetwork interface definition for the public API surface |
| `events.ts` | NetworkEventBus type-safe event definitions (peer connect/disconnect, gossip, reqresp) |
| `options.ts` | NetworkOptions type aggregating all network configuration |
| `networkConfig.ts` | NetworkConfig type storing shared data like node ID and beacon config |
| `forks.ts` | Fork epoch lookahead constant for smooth subscription transitions between forks |
| `metadata.ts` | MetadataController managing our node's ENR (fork version, subnets, sequence number) |
| `statusCache.ts` | Caches our local chain status (head, finalized checkpoint) for Status exchanges |
| `util.ts` | Utility functions for pretty-printing peer IDs and detecting publish errors |
| `index.ts` | Re-exports for the network module |

---

## beacon-node/src/network/core/ — NetworkCore and Worker

NetworkCore is the real implementation that owns all networking components (libp2p, gossipsub, reqresp, peer manager). In the beacon node, it can run on a worker thread with `WorkerNetworkCore` proxying calls across the thread boundary. For the light client with `useWorker: false`, we only care about `networkCore.ts` — everything else in this directory is worker infrastructure we can skip.

| File | Description |
|------|-------------|
| `networkCore.ts` | Actual networking implementation owning libp2p, gossipsub, reqresp, and peer manager |
| `networkCoreWorkerHandler.ts` | Main thread proxy that routes calls to worker thread via MessagePort |
| `networkCoreWorker.ts` | Worker thread entry point that initializes NetworkCore inside a worker |
| `events.ts` | ReqResp bridge event types for cross-thread request/response communication |
| `types.ts` | INetworkCore interface and worker API type definitions |
| `metrics.ts` | Network metrics definitions for Prometheus monitoring |
| `index.ts` | Re-exports for core module |

---

## beacon-node/src/network/libp2p/ — Transport Layer

Creates and configures the libp2p instance — TCP transport, Noise encryption, PeerId from private key, connection limits. The light client reuses this as-is. It's just two files.

| File | Description |
|------|-------------|
| `index.ts` | Creates and configures libp2p instance (TCP, Noise, PeerId, connection limits) |
| `error.ts` | Error types for libp2p transport failures |

---

## beacon-node/src/network/gossip/ — GossipSub Protocol Layer

Configures gossipsub itself — topic names, message encoding, mesh parameters, peer scoring. The beacon node subscribes to 80+ topics (blocks, attestations, blobs, etc.). The light client only needs 2 topics (`light_client_finality_update` and `light_client_optimistic_update`), so we'll use a heavily simplified gossipsub config with minimal scoring.

| File | Description |
|------|-------------|
| `gossipsub.ts` | Eth2Gossipsub class extending libp2p-gossipsub with Ethereum-specific config |
| `interface.ts` | Gossip topic types, message types, and validator function type definitions |
| `topic.ts` | GossipTopicCache parsing and caching gossip topic strings with fork info |
| `encoding.ts` | Message ID generation using SHA256 and snappy compression/decompression |
| `constants.ts` | Gossip protocol constants (message ID length, domain isolation) |
| `errors.ts` | GossipValidationError class for gossip validation failures |
| `scoringParameters.ts` | Gossipsub peer scoring parameters computed from active validator count |
| `metrics.ts` | Gossip-specific metrics definitions |
| `index.ts` | Re-exports for gossip module |

---

## beacon-node/src/network/processor/ — Gossip Message Processing

The application layer on top of gossipsub. After a gossip message arrives, the processor queues it, throttles processing to avoid overloading the main thread, validates it against the chain (BLS signatures, state checks), and reports the result back to gossipsub. This is beacon-node-specific complexity the light client doesn't need — light client gossip messages can be processed directly without queues or multi-stage validation.

| File | Description |
|------|-------------|
| `index.ts` | NetworkProcessor managing gossip validation queues and throttling |
| `gossipHandlers.ts` | Handler functions for each gossip message type (blocks, attestations, etc.) |
| `gossipValidatorFn.ts` | Creates gossip validator functions for batched attestation processing |
| `extractSlotRootFns.ts` | Extracts slot and block root from serialized gossip messages for deduplication |
| `aggregatorTracker.ts` | Tracks aggregator duties per slot/subnet |
| `types.ts` | Types for pending gossip messages (topic, slot, metadata) |
| `gossipQueues/index.ts` | Gossip queue factory creating appropriate queue type per message |
| `gossipQueues/linear.ts` | Simple FIFO gossip queue implementation |
| `gossipQueues/indexed.ts` | Indexed gossip queue with slot-based deduplication |
| `gossipQueues/types.ts` | Gossip queue interface types |

---

## beacon-node/src/network/reqresp/ — Request/Response Protocol (Beacon Node Layer)

The beacon-node-specific ReqResp layer. `ReqRespBeaconNode` extends the base `@lodestar/reqresp` package with protocol registration, peer scoring, and both requester and responder logic. The light client needs the requester side (sending requests, consuming response streams via collectors) but not the responder side (handlers that serve data). Protocol definitions and SSZ type resolvers are reusable.

| File | Description |
|------|-------------|
| `ReqRespBeaconNode.ts` | Beacon node ReqResp class extending base with protocol registration and peer scoring |
| `protocols.ts` | Protocol definitions for all methods (version, context bytes type, rate limits) |
| `types.ts` | ReqRespMethod enum, SSZ type resolvers per fork, and Version enum (V1/V2/V3) |
| `rateLimit.ts` | Rate limit quotas per ReqResp method based on fork and config |
| `score.ts` | Maps ReqResp errors to peer scoring actions (penalize/ban/ignore) |
| `interface.ts` | RateLimiter interface and RespStatus enum for request rate limiting |
| `index.ts` | Re-exports for reqresp module |

---

## beacon-node/src/network/reqresp/handlers/ — Responder-Side Handlers

Each handler is an `async function*` generator that reads from the beacon node's local database and yields serialized response chunks back to the requesting peer. The light client doesn't serve data so these are not needed — but they're useful reference for understanding the wire format and what data each method returns.

| File | Description |
|------|-------------|
| `index.ts` | Wires all handlers into a `GetReqRespHandlerFn` map keyed by ReqRespMethod |
| `beaconBlocksByRange.ts` | Yields blocks from local DB for a slot range |
| `beaconBlocksByRoot.ts` | Yields blocks from local DB matching requested block roots |
| `blobSidecarsByRange.ts` | Yields blob sidecars from local DB for a slot range |
| `blobSidecarsByRoot.ts` | Yields blob sidecars from local DB matching requested roots |
| `dataColumnSidecarsByRange.ts` | Yields data column sidecars from local DB for a slot range |
| `dataColumnSidecarsByRoot.ts` | Yields data column sidecars from local DB matching requested roots |
| `lightClientBootstrap.ts` | Yields a single light client bootstrap object for a given block root |
| `lightClientUpdatesByRange.ts` | Yields light client updates for a range of sync committee periods |
| `lightClientFinalityUpdate.ts` | Yields the latest light client finality update |
| `lightClientOptimisticUpdate.ts` | Yields the latest light client optimistic update |

---

## beacon-node/src/network/reqresp/utils/ — Requester-Side Collectors

Collectors consume the `AsyncIterable<ResponseIncoming>` stream from a peer and deserialize each response chunk into typed objects. The light client will use `collectExactOneTyped` (for bootstrap, finality, optimistic) and `collectMaxResponseTyped` (for updates by range). The block-specific collectors are not needed.

| File | Description |
|------|-------------|
| `collect.ts` | Core collector functions: `collectExactOneTyped`, `collectMaxResponseTyped`, `collectMaxResponseTypedWithBytes` |
| `collectSequentialBlocksInRange.ts` | Collector for BeaconBlocksByRange that validates sequential slot ordering |
| `dataColumnResponseValidation.ts` | Validates data column sidecar responses and logs unavailability |

---

## beacon-node/src/network/peers/ — Peer Management

PeerManager runs a heartbeat loop that pings peers, exchanges Status, triggers discovery when peers are low, and disconnects bad peers. PeersData is the shared in-memory store for all connected peer info. The light client needs a simplified version — fewer peers (10-30), simpler scoring, no subnet-based prioritization.

| File | Description |
|------|-------------|
| `peerManager.ts` | Core peer lifecycle: heartbeat, ping, status, discovery triggers, disconnect |
| `discover.ts` | Orchestrates discv5 queries, filters discovered peers, manages dial backoff |
| `peersData.ts` | In-memory store for connected peer info (status, client, metadata, encoding) |
| `client.ts` | Identifies Ethereum client type (Lighthouse, Teku, Prysm, etc.) from agent strings |
| `datastore.ts` | Persistent peer datastore combining in-memory and database storage |
| `datastore_bun.ts` | Bun-compatible variant of the peer datastore |
| `index.ts` | Re-exports for peers module |

---

## beacon-node/src/network/peers/score/ — Peer Scoring

Two-tier scoring: lodestar score (from RPC behavior) + gossipsub score (from message behavior), combined with exponential decay. The light client can use simpler scoring — primarily based on whether peers respond to LC requests successfully.

| File | Description |
|------|-------------|
| `store.ts` | PeerRpcScoreStore managing scores for all connected peers |
| `score.ts` | RealScore class combining lodestar and gossip sub-scores with exponential decay |
| `constants.ts` | Scoring thresholds for disconnect/ban and decay parameters |
| `interface.ts` | IPeerRpcScoreStore interface and PeerAction enum |
| `utils.ts` | Score computation utilities |
| `index.ts` | Re-exports for score module |

---

## beacon-node/src/network/peers/utils/ — Peer Utilities

Peer filtering and prioritization logic. `assertPeerRelevance` is important for the light client (validates fork compatibility) but `prioritizePeers` is beacon-node-specific (subnet coverage optimization). Subnet-related utils are not needed.

| File | Description |
|------|-------------|
| `assertPeerRelevance.ts` | Validates peer is on same fork, within clock tolerance, and has consistent finalized state |
| `prioritizePeers.ts` | Selects which peers to keep/drop based on score and subnet coverage |
| `enrSubnetsDeserialize.ts` | Deserializes subnet bitfields from ENR records |
| `getConnectedPeerIds.ts` | Extracts connected peer IDs from libp2p connection manager |
| `subnetMap.ts` | Maps peer IDs to their subscribed subnets |
| `index.ts` | Re-exports for peer utils module |

---

## beacon-node/src/network/discv5/ — Peer Discovery

Discv5 finds peers on the network via Kademlia DHT over UDP. Bootstraps from known ENR records, discovers more peers over time. In the beacon node this runs in a separate worker thread; for the light client we can run it in-process. The ENR relevance check (`utils.ts`) is reusable as-is.

| File | Description |
|------|-------------|
| `index.ts` | Discv5Worker wrapper managing peer discovery via Kademlia DHT |
| `worker.ts` | Worker thread entry point for running discv5 in isolation |
| `types.ts` | Discv5 configuration types (ENR options, bind addresses) |
| `utils.ts` | ENR relevance checks (TCP presence, eth2 field, fork digest match) |

---

## beacon-node/src/network/subnets/ — Subnet Management

Manages attestation subnets (64) and sync committee subnets (4) for validators. The light client has no validators and doesn't participate in subnets, so this entire directory is not needed.

| File | Description |
|------|-------------|
| `attnetsService.ts` | Manages attestation subnet subscriptions (64 subnets, long-lived + short-lived) |
| `syncnetsService.ts` | Manages sync committee subnet subscriptions (4 subnets) |
| `interface.ts` | Subnet service interface types |
| `util.ts` | Subnet computation utilities |
| `index.ts` | Re-exports for subnets module |

---

## reqresp/src/ — Base ReqResp Protocol Library

The `@lodestar/reqresp` package is the protocol-level implementation shared by any node that speaks Eth2 ReqResp. It handles stream management, wire format encoding/decoding, rate limiting, and the `async function* sendRequest()` flow. The light client uses this package directly — it's not beacon-node-specific.

| File | Description |
|------|-------------|
| `ReqResp.ts` | Base ReqResp class: protocol registration, stream management, async generator streaming |
| `interface.ts` | RespStatus enum (0=success, 1=invalid, 2=server error, 3=resource unavailable) |
| `types.ts` | ResponseIncoming/ResponseOutgoing types, protocol descriptors, context bytes types |
| `metrics.ts` | ReqResp metrics definitions |
| `index.ts` | Re-exports for the package |

---

## reqresp/src/encoders/ — Wire Format Encode/Decode

Handles the BNF grammar: `<result><context-bytes><header><payload>`. `responseDecode` reads raw bytes from the libp2p stream and yields one `ResponseIncoming` per response chunk. The light client uses the decode side (requester); the encode side is for responders.

| File | Description |
|------|-------------|
| `responseDecode.ts` | Parses raw byte stream into response_chunks: reads result byte, context bytes, then SSZ payload |
| `responseEncode.ts` | Encodes response_chunks to bytes: writes result byte, context bytes, then SSZ payload |
| `requestDecode.ts` | Decodes incoming request bytes from the stream |
| `requestEncode.ts` | Encodes outgoing request bytes to the stream |

---

## reqresp/src/encodingStrategies/sszSnappy/ — SSZ + Snappy Compression

The actual payload encoding: SSZ serialization with Snappy compression, prefixed by a varint length header. This is the `<encoding-dependent-header><encoded-payload>` part of each response chunk. Used transparently by the encoders above.

| File | Description |
|------|-------------|
| `decode.ts` | Reads varint-prefixed length, then decompresses snappy-encoded SSZ payload |
| `encode.ts` | Compresses SSZ payload with snappy and prepends varint length header |
| `errors.ts` | Error types for SSZ/snappy encoding failures |
| `utils.ts` | Shared encoding utilities |
| `index.ts` | Re-exports for sszSnappy module |

---

## reqresp/src/request/ — Outgoing Request Logic

The core of `async function* sendRequest()` — dials a peer, writes the request, sets up timeouts (TTFB, per-chunk), and yields decoded response chunks via `responseDecode`. This is the code path the light client uses for every ReqResp call.

| File | Description |
|------|-------------|
| `index.ts` | `async function* sendRequest()` — dials peer, writes request, yields decoded response chunks |
| `errors.ts` | RequestError types mapping wire status codes to typed errors (timeout, rate limit, etc.) |

---

## reqresp/src/response/ — Incoming Request Logic

Handles the responder side: decodes incoming requests, calls the registered handler, encodes and streams the response back. The light client doesn't serve requests so this is not directly needed, but `ResponseError` is used for error handling on both sides.

| File | Description |
|------|-------------|
| `index.ts` | Handles incoming requests: decodes request, calls handler, encodes and streams response back |
| `errors.ts` | ResponseError class wrapping RespStatus code + error message |

---

## reqresp/src/rate_limiter/ — Rate Limiting

Rate limits incoming requests (per-peer and global) and outgoing requests (max 2 concurrent per protocol per peer). The light client mainly cares about the self rate limiter to avoid overwhelming peers with requests.

| File | Description |
|------|-------------|
| `ReqRespRateLimiter.ts` | Per-peer and global rate limiting for incoming ReqResp requests |
| `rateLimiterGRCA.ts` | Generic Cell Rate Algorithm (GCRA) leaky bucket implementation |
| `selfRateLimiter.ts` | Limits outgoing requests to max 2 concurrent per protocol per peer |

---

## reqresp/src/utils/ — Shared Utilities

Low-level utilities for the ReqResp protocol: stream buffering, abort signal handling, snappy compression, protocol ID formatting. These are internal to the reqresp package and used transparently.

| File | Description |
|------|-------------|
| `bufferedSource.ts` | Wraps async iterable streams with reusable buffer for multi-pass reading |
| `abortableSource.ts` | Wraps async iterables with abort signal support for timeout/cancellation |
| `protocolId.ts` | Formats and parses protocol ID strings (e.g. `/eth2/.../beacon_blocks_by_range/2/ssz_snappy`) |
| `errorMessage.ts` | Encodes/decodes error message strings in response_chunks |
| `collectExactOne.ts` | Collects exactly one item from an async iterable |
| `collectMaxResponse.ts` | Collects up to N items from an async iterable |
| `onChunk.ts` | Callback utility for tracking response chunk progress |
| `peerId.ts` | PeerId string conversion utilities |
| `snappy.ts` | Snappy compression/decompression wrapper |
| `snappyCommon.ts` | Shared snappy constants and types |
| `snappyCompress.ts` | Snappy compression implementation |
| `snappyUncompress.ts` | Snappy decompression implementation |
| `snappyIndex.ts` | Snappy module index |
| `index.ts` | Re-exports for utils module |
