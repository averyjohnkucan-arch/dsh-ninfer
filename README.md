# NInfer for DeepSeek Harness

A local NInfer model provider for DeepSeek Harness. Import a folder to find `.ninfer` models, inspect their components and missing parts, and choose a model. The model's native context is selected when its manifest declares it. Vision and MTP are enabled when present. NInfer requires an explicit draft width for MTP, so the plugin uses the upstream automatic default of three drafts.

## Install

Requires DSH 0.2.1-rc.2, Node 22.19+, Python 3, Linux x86-64 and a supported NVIDIA GPU. In **Plugins → Add plugin**, paste `https://github.com/averyjohnkucan-arch/dsh-ninfer` and enable it. On first activation the plugin downloads the official NInfer release, verifies each part against pinned SHA-256 hashes, and installs it in the plugin data directory. The download is approximately 3.7 GiB. Progress, cancellation and retry appear in **Settings → Models → NInfer → Activity**. Models are separate.

The automatic package is upstream release `2026-10-26.2`, source revision `3d882fc116941d9233c40bf30f4d66dbaa3d24bd`. It includes CUDA runtime libraries. A compatible NVIDIA driver and the release's system library dependencies are required. If needed, the installer downloads pinned, checksum-verified Debian multimedia libraries into the plugin's private runtime, without installing system packages. The plugin selects the CUDA 13 Blackwell release on compute capability 12.0 and CUDA 12 for supported older GPUs. It reports unsupported platforms rather than installing a mismatched package.

## Models and tuning

Choose **Import files**, open a folder and scan it. Complete models can be added; incomplete artifacts show their missing files. The plugin reads manifests and leaves weights in place. NInfer consumes `.ninfer` artifacts. A GGUF must first be converted with NInfer's tools; it is not silently converted here.

NInfer automatically chooses resource settings and calibrates GPU kernels on first use when it has no matching device profile. **Save and calibrate** runs NInfer's native GPU calibration for the model profile. NInfer does not have Strata's Thorough model tuner; calibration is not a full model-specific optimization sweep. KV format options are NInfer's supported formats, not Strata's different K/V pairs.

## Conversation checkpoints

**Advanced → Save conversation checkpoints** enables native disk snapshots for compatible models; it defaults on for imported Qwen3.5-family artifacts. The plugin keeps up to 16 GiB per model, evicting least recently used snapshots first. The top-level **Purge all cache** button unloads plugin-managed models and clears NInfer checkpoints while preserving profiles and weights.

The official NInfer release does not support saving session snapshots with DFlash/DFlash2. Such saves report a warning and fall back to normal prefill. Snapshot support and numerical behavior depend on the model and engine. Checkpoints contain conversation state and live under `~/.dsh/dsh-ninfer/kv` (or `$DSH_HOME/dsh-ninfer/kv`).

## Development

`pnpm install --ignore-scripts`, `pnpm run check`, and `pnpm test`. The `patches/` and `scripts/build-checkpoint-engine.js` retain the older experimental custom build; automatic installation uses the official release and does not claim that patch's DFlash checkpoint support.

## Portable model configs

Use **Export config** beside a saved model, then **Download config JSON**. The export streams every artifact piece through MD5; large models take time and progress appears in Activity. The JSON includes context, KV format, speculation, vision and checkpoint settings, plus the exact byte size and MD5 of each required piece. Model weights are not included.

Use **Import config**, select that JSON, and enter a model folder. The plugin searches its subfolders, checks exact size before MD5, and rebuilds the artifact’s relative shard layout using links. Renamed or relocated files can be matched. Original weights remain in place. Runtime executables, credentials and machine-specific GPU calibration are not imported; calibrate again on the destination GPU.

Runtime downloads retry three times automatically. Bad checksums discard the damaged part before restarting it; interrupted transfers resume. A failed installation keeps a Retry button visible. Complete verified runtime folders are reused, and incomplete folders are preserved while a replacement is staged.
