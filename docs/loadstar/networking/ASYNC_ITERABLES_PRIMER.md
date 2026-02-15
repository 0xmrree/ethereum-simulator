# Async Iterables in Node.js

## Quick Summary

**Async iterables** let you consume a stream of data with `for await...of`. The producer yields data asynchronously, the consumer awaits each item, and backpressure happens naturally through the await suspension.

## Terminology

| Term | What it is |
|------|------------|
| **Async Generator** | Language feature: `async function*` with `yield` |
| **AsyncIterable** | Interface: anything with `[Symbol.asyncIterator]()` |
| **AsyncIterableBridge** | Lodestar's manual implementation of AsyncIterable for cross-thread streaming |

Lodestar's `AsyncIterableBridge` is NOT an async generator—it implements the same interface manually using queues and Promises.

## What Is a Generator Function?

A **generator function** is declared with `function*` (note the asterisk). Unlike regular functions, it doesn't run to completion when called—instead, it returns an **iterator** that you can step through.

```typescript
// Regular function: runs immediately, returns a value
function regular() {
  console.log('I run immediately');
  return 42;
}
const result = regular();  // Prints 'I run immediately', result = 42

// Generator function: returns an iterator, body doesn't run yet
function* generator() {
  console.log('I run later');
  return 42;
}
const iter = generator();  // Nothing printed! iter is an iterator object
iter.next();               // NOW prints 'I run later', returns {value: 42, done: true}
```

**Key difference**: Calling a generator function returns an iterator object. The function body only executes when you call `.next()` on that iterator.

### Why Use Generators?

Generators can **pause** mid-execution using `yield`, then **resume** later. This enables:

1. **Lazy evaluation**: Generate values on-demand instead of computing all at once
2. **Memory efficiency**: Process one item at a time instead of loading everything into an array
3. **Cooperative multitasking**: Pause to let other code run, then resume

```typescript
// Without generator: computes ALL values upfront
function getAllNumbers(): number[] {
  const result = [];
  for (let i = 0; i < 1000000; i++) {
    result.push(i);  // Allocates 1M items in memory
  }
  return result;
}

// With generator: computes values on-demand
function* getNumbersLazily() {
  for (let i = 0; i < 1000000; i++) {
    yield i;  // Only one value in memory at a time
  }
}

// Consumer can stop early without wasting computation
for (const n of getNumbersLazily()) {
  if (n > 10) break;  // Only computed 11 values, not 1M
}
```

## How `yield` Works

`yield` is a keyword that **pauses** a generator function and **returns a value** to the caller. When the caller asks for the next value, execution **resumes** from where it left off.

### Sync Generator (Basics)

```typescript
function* countToThree() {
  console.log('A');
  yield 1;          // Pause here, return 1
  console.log('B');
  yield 2;          // Pause here, return 2
  console.log('C');
  yield 3;          // Pause here, return 3
  console.log('D');
}

const gen = countToThree();  // Nothing runs yet!

gen.next();  // Runs until first yield → prints 'A', returns {value: 1, done: false}
gen.next();  // Resumes, runs until second yield → prints 'B', returns {value: 2, done: false}
gen.next();  // Resumes, runs until third yield → prints 'C', returns {value: 3, done: false}
gen.next();  // Resumes, runs to end → prints 'D', returns {value: undefined, done: true}
```

**Key insight**: The function body doesn't run when you call it. It returns an iterator, and the body only executes incrementally as you call `next()`.

### The Iterator Protocol

A generator returns an object with a `next()` method. Each call to `next()` returns `{value, done}`:

```typescript
function* twoItems() {
  yield 'first';
  yield 'second';
}

const iter = twoItems();
iter.next();  // {value: 'first', done: false}
iter.next();  // {value: 'second', done: false}
iter.next();  // {value: undefined, done: true}  ← no more yields
```

### `for...of` Is Syntactic Sugar

```typescript
// These are equivalent:
for (const x of twoItems()) {
  console.log(x);
}

// Desugars to:
const iter = twoItems();
let result = iter.next();
while (!result.done) {
  console.log(result.value);
  result = iter.next();
}
```

### Async Generators Add `await`

Async generators (`async function*`) can `await` promises AND `yield` values:

```typescript
async function* fetchItems(urls: string[]) {
  for (const url of urls) {
    const data = await fetch(url);  // Can await
    yield await data.json();         // Can yield (pauses until consumer calls next)
  }
}

// Consumer uses for-await-of
for await (const item of fetchItems(['/a', '/b'])) {
  console.log(item);
}
```

The `await` pauses for the promise. The `yield` pauses for the consumer. Both return control to the event loop.

## Basic Async Generator Example

```typescript
// Producer: async generator function
async function* fetchPages(urls: string[]): AsyncGenerator<string> {
  for (const url of urls) {
    const response = await fetch(url);
    yield await response.text();  // yield pauses until consumer is ready
  }
}

// Consumer: for await...of
async function processPages() {
  for await (const page of fetchPages(['/a', '/b', '/c'])) {
    console.log(page.length);  // runs once per yield
  }
}
```

## How Suspension Works

```typescript
async function* producer(): AsyncGenerator<number> {
  console.log('1. Start');
  yield 1;                    // Pauses here until consumer calls next()
  console.log('3. Resume');
  yield 2;
  console.log('5. Done');
}

async function consumer() {
  const gen = producer();
  console.log('2. First next');
  await gen.next();           // Triggers '1. Start', gets {value: 1, done: false}
  console.log('4. Second next');
  await gen.next();           // Triggers '3. Resume', gets {value: 2, done: false}
  await gen.next();           // Triggers '5. Done', gets {done: true}
}
// Output: 1, 2, 3, 4, 5 (interleaved)
```

## Manual AsyncIterable (What AsyncIterableBridge Does)

You can implement the interface without generator syntax:

```typescript
function createAsyncIterable<T>(): {
  iterable: AsyncIterable<T>;
  push: (item: T) => void;
  done: () => void;
} {
  const queue: T[] = [];
  let finished = false;
  let waiting: (() => void) | null = null;

  return {
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            while (true) {
              if (queue.length > 0) {
                return { value: queue.shift()!, done: false };
              }
              if (finished) {
                return { value: undefined as T, done: true };
              }
              // Wait for push() or done()
              await new Promise<void>(resolve => { waiting = resolve; });
            }
          }
        };
      }
    },
    push(item: T) {
      queue.push(item);
      waiting?.();  // Wake up consumer
      waiting = null;
    },
    done() {
      finished = true;
      waiting?.();
    }
  };
}

// Usage
const { iterable, push, done } = createAsyncIterable<number>();

// Consumer (could be on main thread)
(async () => {
  for await (const n of iterable) {
    console.log(n);
  }
})();

// Producer (could be on worker thread via MessagePort)
push(1);
push(2);
push(3);
done();
```

## Cross-Thread Pattern (Lodestar's Use Case)

```
Main Thread                          Worker Thread
────────────                         ─────────────
for await (chunk of stream) {        onNetworkData(data) {
  // suspends here ←─────────────────── bridge.push(data)
  process(chunk);                    }
}
```

The consumer's `await` suspends the task. When the worker calls `push()`, it triggers a MessagePort message that resolves the consumer's Promise, resuming the task.

## Key Points

1. **Backpressure is automatic**: Consumer only pulls when ready
2. **await = task suspension**: Returns control to event loop, not blocking
3. **Cross-thread requires plumbing**: MessagePort + serialization, but same conceptual model
4. **AsyncIterableBridge ≠ async generator**: Same interface, different implementation
