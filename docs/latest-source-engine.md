# Latest source engine

The optional latest-source build targets NInfer-all `40d913db2e87e2211fce4089c0c7920480a5e7a0` with native NVFP4 DFlash2 projection, convolution, context and selector support. The complete patch, source tree and checksum are pinned in `lib/latest-source.json`. Original Neroued NInfer and the consolidated NInfer-all fork have separate revision histories; this build follows the consolidated fork used by this plugin.

Build inside a separate scratch directory, following the pinned upstream toolchain requirements:

```sh
node scripts/build-checkpoint-engine.js --latest-source --root /path/to/scratch/compatible --arch 120a --jobs 16
```

To compare its optional native Blackwell backend, use another root:

```sh
node scripts/build-checkpoint-engine.js --latest-source --native-blackwell --root /path/to/scratch/native --arch 120a --jobs 16
```

The script builds the server and matching calibrator. Select the resulting server through the profile's executable override. Give each backend its own `--device-profile-path`; an old calibration belongs to its own route catalog. Preparing the source with `--prepare-only` verifies the patch and complete source tree without compiling or loading a model.

The latest source keeps the stock KV and embedding contracts. It does not include the legacy custom Q5_1/Q6_0 KV formats or `--output-head-residency`; remove that residency flag when using the latest build. The existing packaged custom runtime remains available for those legacy profiles. Source builds are separate from automatic installation of that verified release.

NVFP4 selector codebooks enter the conditional score as represented FP32 values, with no intermediate BF16 rounding. Optional selector confidence is the selected candidate's temperature-one probability. Focused tests cover both selector schedules, supported batch/width boundaries, graph capture, confidence and independent FP64 references. The projection, convolution and context routes have independent numerical checks. Consumer Blackwell Linux is the tested custom-build scope; other architectures and Windows are not qualified by these tests.

Whole-model throughput and quality are separate from Op qualification. Short startup checks and small generated-function tests do not establish full-context performance or BF16-reference perplexity. Use measured profiles and their workload receipts when comparing backends.
