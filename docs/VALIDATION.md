# Validation for v0.4.0

- 68 JavaScript tests and 11 Python tests, plus host/client syntax checks.
- Fresh custom-runtime installation and reuse in an isolated data directory; archive, file and source-provenance verification; preservation of the previous runtime on failure.
- Matching server and calibration launchers with the complete private loader/library package.
- Both recovered Desktop configurations imported against actual model files using size and MD5 matching, preserving context, KV, draft and placement settings.
- Huihui IQ3_S: 262,144 context allocation, int8 KV, DFlash2; startup and a short successful response.
- NVFP4-full: 196,608 context allocation, Q5_1 KV, DFlash2; startup and a short successful response.
- Package contents include the installer, pinned manifest, patches and cache template. Runtime binaries and model weights are downloaded separately.

The short response checks do not establish fresh throughput, full-context numerical parity, tool/vision quality or performance on other GPUs. Other GPU architectures retain the upstream installer path; this release does not claim a custom-engine GPU test on those cards.

The GitHub runtime-verification workflow checks the exact published manifest, parts, archive and every extracted file, then runs both launchers on Ubuntu 24.04 with a test-only CUDA driver stub. This checks relocation and dependency completeness without claiming GPU inference on the hosted runner.

# Validation for v0.1.0

- Host and Client JavaScript syntax checks.
- Profile persistence, multiple models, deleting a profile without deleting model files.
- Native argv construction and reproduction of the supplied NInfer launch flags.
- Owned subprocess readiness and termination; external attachment detaches without terminating its server.
- Local streaming through the public DSH PiAiAdapter, with usage and DSH attribution.
- Packed installation in a clean DSH 0.2.1-rc.2 Web profile without dependency build scripts.
- Both cards rendered in the real DSH Models settings; existing model profiles visible.
- Strata: manual tuning locks, staged search / 5% decode constraint under deterministic evaluator tests, GGUF classification and incomplete/ambiguous selections.
- Strata: real 33-shard Atomic Q5 selection and projector identification; source profiles retained exact argument order and existing referenced paths.
- NInfer: pinned OCI manifest and presence of expected runtime layer verified against the registry.

Not performed: new full-model inference, new GPU tuning, repeated calibration, clean-machine compiler/runtime installation on every platform, or numerical parity after quantization. Existing saved tunes were imported as requested. Supported platform and format limits are in README.md.
