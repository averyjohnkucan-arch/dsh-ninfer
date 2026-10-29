# Scheduler integration validation

Tested Strata 0.6.4, NInfer 0.4.3 and Dory 0.2.1 against the shared scheduler. The integration harness used the actual provider runtime classes and scheduler, with in-memory server drivers so queue behavior could be tested without loading three GPU models. It verified NInfer → Strata → Dory handoff, lease retention through checkpoint IO, queued cancellation, NInfer calibration admission, Strata tuning admission and retry after a failed load. Scheduler 0.2.0 additionally has deterministic tests for the 60-second idle policy, five-second quiet handoff, timer reset and four conversations grouped by model.

Native engine sources and binaries were not changed. A separate live Flash Next Gyro S test on a 24 GB RTX PRO 5000 Blackwell reproduced session allocation failure while NInfer held 18.4 GiB. After confirming NInfer was idle and unloading it, the same 262,144-context FP16/FP16 profile loaded with MTP and vision enabled and answered `2 + 2` with `4`. The GPU was released after testing. This checks text inference and vision-enabled startup; image inference and three-provider native generation were not tested.

Provider suite: 81 JavaScript and 11 Python tests passed, along with the configured build/check commands.
