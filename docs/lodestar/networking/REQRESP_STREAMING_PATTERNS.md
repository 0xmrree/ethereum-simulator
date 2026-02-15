# ReqResp Streaming Patterns in Lodestar

Lodestar supports two streaming patterns for ReqResp responses, controlled by the `useWorker` configuration option.

## Overview

| Mode | Where Networking Runs | Streaming Mechanism | Backpressure |
|------|----------------------|---------------------|--------------|
| `useWorker: true` | Worker thread | AsyncIterableBridge (queue + MessagePort) | Consumer only (queue unbounded) |
| `useWorker: false` | Main thread | Native async generators (`yield*`) | Full bidirectional |

---

## Pattern 1: Worker Thread (AsyncIterableBridge)

When networking runs in a worker thread, responses must cross the thread boundary. Lodestar uses `AsyncIterableBridge` to accomplish this.

### Conceptual Model

```
Worker Thread                              Main Thread
─────────────                              ───────────
NetworkCore                                Network (facade)
    │                                           │
    ▼                                           ▼
ReqResp receives                           Consumer calls
response chunks                            for await (chunk of stream)
    │                                           │
    ▼                                           ▼
AsyncIterableBridgeHandler                 AsyncIterableBridgeCaller
pushes to queue ──────────────────────────► queue stores items
    │               (MessagePort)               │
    ▼                                           ▼
emitResponse({type: next, item})           onNext callback resolves
                                           waiting consumer Promise
```

### Key Characteristics

1. **Queue-based**: Items accumulate in a `LinkedList` on the main thread
2. **Consumer waits for producer**: When queue is empty, consumer suspends via Promise
3. **Producer does NOT wait**: Queue can grow unbounded (no backpressure to worker)
4. **Cross-thread**: MessagePort serializes events between threads

### Trade-offs

- **Pro**: Decouples network I/O from main thread processing
- **Pro**: Network can keep receiving while main thread is busy
- **Con**: Memory can grow if consumer is slow (relies on TCP backpressure)
- **Con**: Added complexity of bridge, serialization, message passing

---

## Pattern 2: Main Thread (Native Async Generators)

When networking runs on the main thread (`useWorker: false`), Lodestar uses native async generators with `yield*`. This is simpler and provides true bidirectional backpressure.

### Full Code Flow: `BeaconBlocksByRange` Example

#### 1. Sync Component Initiates Request

```typescript
// packages/beacon-node/src/network/network.ts:512-526

async sendBeaconBlocksByRange(
  peerId: PeerIdStr,
  request: phase0.BeaconBlocksByRangeRequest
): Promise<SignedBeaconBlock[]> {
  return collectSequentialBlocksInRange(
    this.sendReqRespRequest(peerId, ReqRespMethod.BeaconBlocksByRange, [...], request),
    request
  );
}
```

The `sendReqRespRequest` returns an `AsyncIterable<ResponseIncoming>`, which `collectSequentialBlocksInRange` consumes.

#### 2. Network Delegates to Core

```typescript
// packages/beacon-node/src/network/network.ts:620-632

private sendReqRespRequest<Req>(
  peerId: PeerIdStr,
  method: ReqRespMethod,
  versions: number[],
  request: Req
): AsyncIterable<ResponseIncoming> {
  const requestData = requestType.serialize(request);
  return this.core.sendReqRespRequest({peerId, method, versions, requestData});
}
```

#### 3. NetworkCore (Main Thread) Calls ReqResp

```typescript
// packages/beacon-node/src/network/core/networkCore.ts:362-365

sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming> {
  const peerId = peerIdFromString(data.peerId);
  return this.reqResp.sendRequestWithoutEncoding(peerId, data.method, data.versions, data.requestData);
}
```

#### 4. ReqRespBeaconNode Calls Base sendRequest

```typescript
// packages/beacon-node/src/network/reqresp/ReqRespBeaconNode.ts:149-167

sendRequestWithoutEncoding(
  peerId: PeerId,
  method: ReqRespMethod,
  versions: number[],
  requestData: Uint8Array
): AsyncIterable<ResponseIncoming> {
  const encoding = this.peersData.getEncodingPreference(peerId.toString()) ?? Encoding.SSZ_SNAPPY;
  return this.sendRequest(peerId, method, versions, encoding, requestData);
}
```

#### 5. ReqResp Base Class: The Async Generator

```typescript
// packages/reqresp/src/ReqResp.ts:153-221

async *sendRequest(
  peerId: PeerId,
  method: string,
  versions: number[],
  encoding: Encoding,
  body: Uint8Array
): AsyncIterable<ResponseIncoming> {
  // ... rate limiting, protocol setup ...

  try {
    yield* sendRequest(  // ← Delegates to request/index.ts
      {logger, libp2p, metrics, peerClient},
      peerId, protocols, protocolIDs, body, signal, opts, requestId
    );
  } catch (e) {
    // ... error handling ...
  }
}
```

#### 6. Low-Level Request: Stream Processing

```typescript
// packages/reqresp/src/request/index.ts:51-200

export async function* sendRequest(
  {logger, libp2p, metrics, peerClient}: SendRequestModules,
  peerId: PeerId,
  protocols: MixedProtocol[],
  protocolIDs: string[],
  requestBody: Uint8Array,
  signal?: AbortSignal,
  opts?: SendRequestOpts,
  requestId = 0
): AsyncIterable<ResponseIncoming> {

  // 1. Dial peer and negotiate protocol
  const stream = await withTimeout(
    async (timeoutSignal) => libp2p.dialProtocol(peerId, protocolIds, {signal: timeoutSignal}),
    DIAL_TIMEOUT, signal
  );

  // 2. Send request bytes
  await withTimeout(
    () => pipe(requestEncode(protocol, requestBody), stream.sink),
    REQUEST_TIMEOUT, signal
  );

  // 3. Yield response chunks as they arrive from the stream
  yield* pipe(
    abortableSource(stream.source, [ttfbTimeout, respTimeout]),
    responseDecode(protocol, {
      onFirstHeader() { /* cancel TTFB timeout, start RESP timeout */ },
      onFirstResponseChunk() { /* restart RESP timeout for next chunk */ },
    })
  );
}
```

**Key insight**: The `yield*` delegates to the stream decoder, which itself yields decoded response chunks. Each `yield` pauses this generator until the consumer calls `next()`.

#### 7. Consumer: Collecting Blocks

```typescript
// packages/beacon-node/src/network/reqresp/utils/collectSequentialBlocksInRange.ts:12-42

export async function collectSequentialBlocksInRange(
  blockStream: AsyncIterable<ResponseIncoming>,
  {count, startSlot}: Pick<phase0.BeaconBlocksByRangeRequest, "count" | "startSlot">
): Promise<SignedBeaconBlock[]> {
  const blocks: SignedBeaconBlock[] = [];

  for await (const chunk of blockStream) {  // ← Each iteration pulls one block
    const block = sszDeserializeResponse(blockType, chunk.data);

    // Validation...

    blocks.push(block);
    if (blocks.length >= count) {
      break;  // Early exit - generator cleanup runs
    }
  }

  return blocks;
}
```

### How Backpressure Works

```
Consumer                          Producer (async generator)
────────                          ─────────────────────────
for await (chunk of stream)
    │
    ├─► calls stream[Symbol.asyncIterator]().next()
    │       │
    │       └─► Generator resumes from last yield
    │           │
    │           ├─► await network data (suspends for I/O)
    │           │       ↓
    │           │   Network delivers bytes
    │           │       ↓
    │           ├─► decode chunk
    │           │
    │           └─► yield chunk (PAUSES generator)
    │                   │
    ◄───────────────────┘ returns {value: chunk, done: false}
    │
    ├─► process(chunk)  ← Consumer does work
    │
    └─► loop back to next()  ← Only NOW does generator resume
```

**The generator cannot produce the next item until the consumer asks for it.** This is true bidirectional backpressure:
- Consumer waits for producer (via `await` on `next()`)
- Producer waits for consumer (via `yield` pause)

### Why This Pattern Works Well

1. **Language-native**: No manual queue management
2. **Memory efficient**: Only one chunk in flight at a time
3. **Simple control flow**: Linear code, easy to trace
4. **Automatic cleanup**: `break` or `return` triggers generator's `finally` blocks
5. **Error propagation**: Exceptions bubble naturally through the chain

---

## Comparison Summary

```
                    Worker Thread              Main Thread
                    (AsyncIterableBridge)      (Async Generator)
                    ─────────────────────      ─────────────────

Code complexity     Higher                     Lower
Memory model        Queue (can grow)           Single item in flight
Backpressure        Consumer-side only         Bidirectional
Thread isolation    Yes (I/O separate)         No (all on main)
Latency             MessagePort overhead       Direct
Error handling      Must serialize errors      Native exceptions

Best for:           Production beacon nodes    Testing, simple clients
                    Heavy I/O workloads        Resource-constrained
```

---

## ReqResp Architecture: Handlers and Collectors

Lodestar separates the two sides of a ReqResp exchange into distinct components. **Handlers** define the responder logic — when a peer requests data from you, the handler reads from local storage (database, chain state) and `yield`s response chunks back over the stream. For example, `onLightClientUpdatesByRange` loops through sync committee periods, fetches each precomputed update from `lightClientServer.getUpdate(period)`, serializes it, and yields one `ResponseOutgoing` per period. **Collectors** define the requester logic — when you request data from a peer, the collector consumes the incoming `AsyncIterable<ResponseIncoming>` stream and deserializes each chunk into its typed object. The key step in every collector is resolving the SSZ type from the chunk's `fork` context bytes, then calling `type.deserialize(chunk.data)` to convert raw bytes into usable types like `LightClientUpdate` or `SignedBeaconBlock`.

There are three collector variants, each suited to different response patterns. `collectExactOneTyped` handles single-response methods (Bootstrap, Status, Ping) — it deserializes the first chunk and returns immediately. `collectMaxResponseTyped` handles multi-response methods (LightClientUpdatesByRange, BlobSidecarsByRange) — it accumulates deserialized objects into an array up to a max count. `collectMaxResponseTypedWithBytes` does the same but additionally caches the raw serialized bytes alongside the deserialized object, which beacon nodes use to re-gossip blocks to other peers without paying the cost of re-serialization. For light client methods, the simpler `collectMaxResponseTyped` is sufficient since light clients consume data but don't re-gossip it.

Each response chunk on the wire follows the Ethereum consensus spec's BNF format: `<result><context-bytes><encoding-dependent-header><encoded-payload>`. The `<result>` is a single byte (0 = success, 1 = invalid request, 2 = server error, 3 = resource unavailable, 128-255 = reserved). The `<context-bytes>` carry fork information so the receiver knows which SSZ schema to use for deserialization. Lodestar's `responseDecode` reads these bytes from the raw libp2p stream, parses them into structured `ResponseIncoming` objects, and yields one per response chunk — this is the bridge between raw network bytes and the typed collector layer above.

## For Light Client Implementation

Consider starting with `useWorker: false` (main thread / async generators) because:

1. **Simpler**: No bridge, no worker setup, no message serialization
2. **Light workload**: LC responses are small (~50KB updates vs 2MB blocks)
3. **True backpressure**: Memory bounded by design
4. **Easier debugging**: Single thread, clear stack traces

If performance profiling shows I/O blocking issues, the worker pattern can be added later. The `AsyncIterable` interface is the same either way—only the implementation changes.
