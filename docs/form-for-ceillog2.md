Got it — here’s a **tight explanation** of bit-width:

---

**Bit-width** of a non-negative integer `x` is the **minimum number of bits needed to represent `x` in binary**, ignoring leading zeros. Formally, for `x > 0`:

[
\text{bit-width}(x) = \lfloor \log_2(x) \rfloor + 1
]

* `floor(log₂(x))` gives the index of the most significant bit (MSB).
* `+1` to account for zero index at first place

Intuition: the MSB tells you the largest power of two in the number, and the bit-width is how many bits you need to encode that number fully.

This is why, to represent `n` distinct values (`0..n-1`), the minimum bits required is the **bit-width of `n-1`**, i.e., `(n-1).ilog2() + 1` in Rust.
