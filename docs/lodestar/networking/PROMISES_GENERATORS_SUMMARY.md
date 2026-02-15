# Promises, Generators, and Async Generators

## Promises

A **promise** represents a value that may not be available yet. When you call a function that returns a promise, that promise is either pending (not yet resolved) or settled (resolved with a value or rejected with an error). The resolution typically happens later—triggered by a timer, I/O completion, or a message from another thread. The caller has two choices: store the promise and continue doing other work, or `await` it. When you `await`, your task suspends (it's parked, not queued) and a continuation is registered on the promise. When the promise resolves, that continuation gets queued on the event loop, and your task resumes from where it left off. This is cooperative concurrency—`await` never blocks the thread, it just suspends the current task while others can run.

## Generators

A **generator function** (`function*`) is a function that can pause mid-execution and resume later. When you call a generator function, it doesn't run—it returns an iterator object. The function body only executes when you call `.next()` on that iterator, running until it hits a `yield` statement. The `yield` pauses execution and returns a value to the caller. The next `.next()` call resumes from where it paused. This enables lazy evaluation (compute values on-demand), memory efficiency (one item in memory at a time), and early termination (consumer can stop before producer finishes). The `for...of` loop is syntactic sugar that repeatedly calls `.next()` until `done: true`. Importantly, `yield` in a sync generator just returns control to the direct caller—it has nothing to do with the event loop.

## Async Generators

An **async generator** (`async function*`) combines both mechanisms: it can `await` promises AND `yield` values. The `await` suspends the task until a promise resolves (event loop can run other work). The `yield` pauses for the consumer (whoever called `.next()`). When consumed with `for await...of`, each iteration awaits the next value, allowing the event loop to breathe between items. This makes async generators ideal for streaming data: a producer yields items as they arrive (from network, files, or another thread), and a consumer processes them one at a time with natural backpressure—the producer only advances when the consumer is ready for more. Lodestar's `AsyncIterableBridge` implements the same `AsyncIterable` interface manually (using queues and promises) to stream ReqResp data across worker thread boundaries.
