# OpenTelemetry and Trace Sampling

## What is OpenTelemetry?

OpenTelemetry is an observability framework for collecting telemetry data (metrics, logs, and traces) from applications. It provides a vendor-neutral API so you instrument your code once, then can send data to any compatible backend (Prometheus, Jaeger, Datadog, etc.) - essentially the "Terraform of telemetry."

**The three pillars:**
- **Metrics**: Numerical measurements over time (counters, gauges, histograms)
- **Traces**: Show the path of a request through your system with structured parent-child span relationships
- **Logs**: Semi-structured text messages with context

**Telemetry** means "remote measurement" - measuring what's happening in your running application and transmitting that data for analysis.

**Instrumenting code** means adding code that emits telemetry data, like adding a thermometer to measure temperature. For example, wrapping functions with timing code or emitting counter metrics.

## Traces vs Logs vs Metrics

Logs are actually the least structured form of telemetry, not the most primitive. Modern observability thinking treats metrics and traces as more structured primitives:
- Metrics are pure numbers with dimensions
- Traces are structured spans with relationships and timing
- Logs are text that you parse after the fact

While you can derive metrics from logs (counting ERROR occurrences), it's inefficient compared to emitting metrics directly.

## Distributed Tracing

Traces automate what's traditionally done manually by correlating logs. Instead of grep-ing through logs trying to match timestamps for "user 123 hit service A then service B," OpenTelemetry automatically threads a trace ID through all operations, giving you a visual waterfall of the complete user journey.

## Trace Sampling

When a report came in about high resource consumption with OpenTelemetry enabled in Lighthouse (an Ethereum beacon node), the solution was to default to trace sampling.

**How sampling works:**
Sampling happens at the **trace level** (entire request journey), not at the span level. If you sample at 1%, that means:
- 1% of requests get fully traced - every span, every operation, complete end-to-end
- 99% of requests get no tracing at all

This gives you complete pictures of sampled requests rather than fragmented traces. The sampling decision is made early (at the root span) and propagated through the entire distributed trace.

**Why this is effective:**
You get enough data for observability (patterns, outliers, performance issues) without the massive overhead of capturing everything. For a beacon node, you'd get complete traces of operations like block imports, attestation aggregation, and validator duties - just not for every single operation.

## Context: Alloy Traces

In the Lighthouse issue, "alloy traces" referred to trace-level logging from the Alloy Rust crate (an Ethereum library used by execution clients like Reth). The user was running:
- Lighthouse beacon node with OpenTelemetry enabled
- An execution client (likely using Alloy) with TRACE-level logging enabled
- Profiling tools

TRACE is the most verbose Rust logging level, capturing everything including tight loops. Combined with full OpenTelemetry trace collection and profiling, this created massive resource consumption.

Note: Lighthouse itself does NOT use Alloy - it's a pure consensus layer client. The Alloy traces were from other components in the user's stack (execution client, monitoring tools, etc.).