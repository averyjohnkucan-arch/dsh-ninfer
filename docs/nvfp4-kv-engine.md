# Packaged NVFP4 and KV engine

On Linux x86-64 with a consumer Blackwell GPU (SM120), activation downloads the pinned custom runtime from this repository's GitHub releases. It includes the matching server, calibrator, private loader and runtime libraries. Installation verifies the archive parts and every runtime file against `scripts/custom-runtime.json` before replacing a previous installation. The host supplies the NVIDIA driver; a compiler and CUDA toolkit are not required.

The engine is upstream revision `5ed86dff9fe3a5a0776f40a7aea86cf381da990d` plus `patches/ninfer-nvfp4-kv.patch`. Source revision, patched tree and patch SHA-256 are recorded in `lib/engine.json` and the runtime manifest. The patch includes persistent checkpoints, native NVFP4 DFlash2 routes, Q5_1/Q6_0 KV storage and embedding/output-head residency controls.

Other previously supported NVIDIA GPUs use the pinned official runtime. Its UI does not offer custom-only Q5_1/Q6_0 KV formats. An imported profile requiring them reports the incompatibility before loading. Advanced settings retain an executable override for compatible external builds.

## Optional source build

`scripts/package-custom-engine.py` builds and packages the pinned source for maintainers. The `custom-engine` GitHub workflow uses the architecture list in `lib/engine.json`. Building requires CMake, Ninja, Git and a compatible C++/CUDA toolchain. This is separate from normal plugin installation.

To reconstruct and verify the source without compiling or starting a model:

```sh
node scripts/build-checkpoint-engine.js --root /path/to/isolated/runtime --prepare-only
```

## Validation limits

The packaged runtime passed clean local installation, verified reuse and imports of both recovered profiles. Huihui IQ3_S at 262,144 context with int8 KV and NVFP4-full at 196,608 context with Q5_1 KV each started and answered a short request using their saved DFlash2 settings. These checks establish startup and response compatibility, not new throughput results, full-context numerical parity, vision quality or qualification of other GPUs. Historical checkpoint tests are documented separately in `CHECKPOINT-VALIDATION.md`.
