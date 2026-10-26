# Packaged NVFP4 and KV engine

The plugin carries the exact engine patch in `patches/ninfer-nvfp4-kv.patch`, over the revision in `lib/engine.json`. The installer verifies the patch checksum and the complete resulting Git tree. The patch includes the checkpoint implementation, native NVFP4 DFlash2 routes, genuine Q5_1 and Q6_0 KV storage, and exact-byte vocabulary placement controls.

Engine setup creates a revision-and-patch-specific directory under the plugin-owned runtime root. It does not overwrite an older build or rewrite other profiles. CUDA architecture is detected from the first NVIDIA GPU, or selected explicitly with `--arch`; supported targets and required CUDA versions follow the engine documentation. CMake, Ninja, a compatible C++/CUDA toolchain, Git and NVIDIA drivers are installation prerequisites. Model weights are imported separately. There are no developer-machine model or executable paths in fresh presets.

For source-only installation validation without compiling or starting a GPU model:

```sh
node scripts/build-checkpoint-engine.js --root /path/to/isolated/runtime --prepare-only
```

Normal setup performs the CUDA build and reports the resulting source and executable paths to the owning profile. Packaged source reconstruction is verified. Five focused GPU tests passed on the isolated implementation, and earlier native 262K forward tests used host vocabulary. These results do **not** establish current all-GPU fit, throughput, chat/tool/vision quality, or fresh-harness runtime acceptance. Those validations remain pending; do not treat installation as model qualification.
