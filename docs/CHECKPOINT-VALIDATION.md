# Native checkpoint qualification — 0.1.5

Tested on 2026-10-21 with an RTX PRO 5000 Blackwell Laptop GPU, the pinned
`5ed86dff9fe3a5a0776f40a7aea86cf381da990d` engine plus the packaged patch, and
Huihui Qwen3.8 27B IQ3_S, DFlash2 K=7, int8 KV, 8,192-token context.
The test used a 3,614-token prompt and greedy decoding; the continuation was
limited to 64 output tokens. These short responses are a correctness workload,
not a representative conversational throughput benchmark.

The public native API saved a checkpoint, the engine process was stopped and
restarted, and the snapshot was restored. The restored continuation exactly
matched uninterrupted greedy output. A different first user message reused
the shared system prefix and exactly matched another fresh-process cold run.
The public DSH PiAiAdapter also completed a real inference and automatically
published a checkpoint with the native slot digest.

The existing production Huihui profile also started with its unchanged 262,144
token context allocation and 16 GiB host-cache budget, and the public DSH
adapter completed a short request and saved its checkpoint. This validates
startup and integration at that allocation, not numerical parity at 262k tokens.

| Measurement | Result |
| --- | ---: |
| Initial cold prompt, first token | 4.316 s |
| Resident continuation, first token | 0.105 s |
| Resident continuation reused tokens | 3,616 / 3,645 |
| Snapshot bytes | 484,592,907 |
| Native snapshot save | 0.772 s |
| Snapshot restore, HTTP wall time | 0.488 s |
| First continuation after restore, first token | 1.467 s |
| Different user/new chat after restore, first token | 0.117 s |
| Different user/new chat reused tokens | 3,593 / 3,620 |

Time to first token starts at the completion request, so restore time is
additional. Model weight loading, CUDA graph setup and startup warmup are
excluded; startup took roughly 27 seconds for this test profile. A full model
switch therefore does not take one or two seconds on this setup.

The stock hybrid-cache baseline on the same short workload had 0.098 s resident
first-token latency and 172.8 decoded tokens/s, versus 0.105 s and 168.1 tokens/s
for the patched catalog run. These are single runs, not a statistical comparison;
they show no measured speedup over the existing resident cache. The new capability
is persistence across engine restarts. The baseline used a 4 GiB host cache; the
checkpoint catalog used 8 GiB because its extra anchor images did not fit the
4 GiB budget's state allocation limit.

The second installed Qwen3.8 27B profile also passed capture/restart/restore and
cold comparison using rk4v4 KV and its normal 262,144-token allocation (about
3,400 actual prompt tokens). Resident and disk-restored continuations reused
3,410 tokens and produced identical greedy output. The shared-prefix new chat
reused 3,387 tokens and matched cold output. Its 423,244,286-byte snapshot took
0.631 s to save and 0.401 s to restore. First-token times were 0.109 s resident,
1.485 s after restore, and 0.116 s for the restored shared-prefix new chat.
The two cold requests measured 4.054 s and 13.456 s; that variation has not been
attributed, and these single runs do not establish steady-state throughput.

Issues found and fixed during qualification:

- Stock DFlash2 rejected snapshots. The patch persists its draft frontier;
  draft cyclic state was already part of the native state image.
- A valid mid-prefill shared prefix was excluded from saving because it lacked
  final-token output state. It is now saved as an exact-prefix-validated anchor.
- Restoring optional anchors into every free device state slot prevented
  branching from a restored prefix. Optional images now prefer host RAM;
  the endpoint still prefers the GPU. Increasing the planner search budget or
  adding one device state slot did not fix this failure.
- An aborted adapter waiter could decrement another call's activity count.
  The adapter now decrements only after entering its serialized operation.

Costs and limits: these are full snapshots, not deltas. Even this short prompt
wrote about 462 MiB because recurrent/draft state images are large. Each chat
retains the last two model configurations; disk use grows with chat count and
context. Edits resume at a compatible saved anchor, not necessarily the exact
edited token. Corrupt/incompatible snapshots fall back to prefill with a warning.
The GPU qualification covers DFlash2 with these two models and KV formats; ordinary
DFlash, other model families, full-context 262k continuation parity and other
GPU architectures have not been qualified by this test.

Reproduction: use `scripts/verify-checkpoints.py` with a dedicated profile,
following the capture/restart/restore/restart/cold sequence in the README.
The regression suite separately checks durable publication, failure retention,
two-model eviction, resident-cache avoidance of disk restore, per-chat isolation,
prefix matching, cancelled waiters and the real public provider callback path.
