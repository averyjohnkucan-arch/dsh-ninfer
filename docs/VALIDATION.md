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
