# One balanced profile per model

Six recommended profiles. Each uses ONE set of engine and sampling settings at both context depths. The two p/d pairs in its name are measurements, not selectable settings.

Protocol: 10% counting, then 90% prose/chat. 1,024 generated tokens; final 512 timed. Thinking off; no reused prefix. Rates in tokens/second. Before means original saved engine controls remeasured under the same protocol and sampler.

| Model | Before 10% | After 10% | Before 90% | After 90% |
|---|---:|---:|---:|---:|
|27B NVFP4 — NInfer|p2990/d175.3|p2990/d175.3|p1390/d41.9|p1390/d41.9|
|Huihui IQ3_S — NInfer, INT8 KV|p1206/d141.5|p1256/d133.7|p799/d35.2|p843/d38.6|
|Flash NVFP4 — Basalt, INT8 KV|p3123/d209.6|p3172/d217.1|p3197/d54.3|p3208/d63.3|
|Flash NVFP4/Q8 hybrid — Basalt, INT8 KV|p2253/d114.5|p2253/d114.5|p2376/d34.4|p2376/d34.4|
|Gyro S — Strata, FP16 KV|p2178/d101.2|p2178/d101.2|p2139/d72.0|p2139/d72.0|
|DeepSeek XXS — Basalt|p1012/d38.9|p1012/d38.9|p711/d24.8|p711/d24.8|

Selection prioritizes 90% decode, then accepts a 1% decode loss only for at least 3% prefill gain among usable candidates. No cache/buffer/KV retuning was performed merely to change the non-model RAM allowance.

All six recommended profiles passed real plugin adapter launches. All 13 tested variants passed after the Strata startup fix; the seven nonselected variants are reference material in tested alternatives. The historical full test matrix includes a fourteenth diagnostic Basalt 27B case with poor host-KV-offload performance; it is not recommended.

Huihui benchmark framing was corrected and selected prose passed repetition screening and excerpt review. Speculative generated-code checks passed 17/18; the failed LRU case was a rejected NInfer K3 trial. These small tests do not establish general model accuracy.

Strata Flash, now an archived alternative, required STRATA_NO_ARENA_THP=1 to avoid reproduced startup compaction pressure. Its corrected measurements were p2096/d109.9 and p2306/d51.5. Gyro S does not use that workaround.

## Status and use

Completed: throughput comparisons, selected-output review, six-profile selection, adapter validation, profile names, original backups, table and chart.

Plugin packages are staged in plugin packages and are not installed into live DSH. These JSON files are native provider profile snapshots, not portable model manifests; do not use the portable model-import dialog for them. Keep their referenced model/runtime/ranking files in place. Original snapshots and tested alternatives are preserved.

GitHub publication status is recorded separately in github-publication.json when completed.
