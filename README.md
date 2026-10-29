# NInfer for DeepSeek Harness

A local NInfer model provider for DeepSeek Harness. Import a folder to find `.ninfer` models, inspect their components and missing parts, and choose a model. The model's native context is selected when its manifest declares it. Vision and MTP are enabled when present. NInfer requires an explicit draft width for MTP, so the plugin uses the upstream automatic default of three drafts.

## Install

Requires DSH 0.2.1-rc.2, Node 22.19+, Python 3.12+, Linux x86-64 and a compatible NVIDIA driver. In **Plugins → Add plugin**, paste `https://github.com/averyjohnkucan-arch/dsh-ninfer` and enable it.

On consumer Blackwell GPUs (SM120), first activation downloads the **custom engine from this repository's GitHub release**, verifies every archive part and runtime file with SHA-256, and selects it automatically. The package contains the matching server and calibration tool, CUDA and multimedia libraries, and a matching private glibc loader. No compiler, CUDA toolkit, old model folders or Desktop launcher is needed. The host supplies the NVIDIA driver. The runtime download is approximately 1.5 GiB; model weights are separate.

This custom runtime uses upstream revision `5ed86dff9fe3a5a0776f40a7aea86cf381da990d` plus the checksum-pinned NVFP4 patch in this repository. It includes Q5_1/Q6_0 KV storage and embedding/output-head residency controls used by the recovered NVFP4 profiles. Other previously supported NVIDIA GPUs retain the pinned official NInfer release; custom-only KV controls are not advertised for that fallback.

Progress, cancellation and retry appear in **Settings → Models → NInfer → Activity**. Existing runtimes are preserved while a verified replacement is staged. Native GPU calibration defaults to the plugin's own data directory. Models are imported separately and stay where they are.

## Models and tuning

Choose **Import files**, open a folder and scan it. Complete models can be added; incomplete artifacts show their missing files. The plugin reads manifests and leaves weights in place. NInfer consumes `.ninfer` artifacts. A GGUF must first be converted with NInfer's tools; it is not silently converted here.

NInfer automatically chooses resource settings and calibrates GPU kernels on first use when it has no matching device profile. **Save and calibrate** runs NInfer's native GPU calibration for the model profile. NInfer does not have Strata's Thorough model tuner; calibration is not a full model-specific optimization sweep. KV format options are NInfer's supported formats, not Strata's different K/V pairs.

## Conversation checkpoints

**Advanced → Save conversation checkpoints** enables native disk snapshots for compatible models; it defaults on for imported Qwen3.5-family artifacts. The plugin keeps up to 16 GiB per model, evicting least recently used snapshots first. The top-level **Purge all cache** button unloads plugin-managed models and clears NInfer checkpoints while preserving profiles and weights.

Snapshot support and numerical behavior depend on the model and engine. Unsupported saves report a warning and fall back to normal prefill; the plugin does not report an unsuccessful save as a cache hit. Checkpoints contain conversation state and live under `~/.dsh/dsh-ninfer/kv` (or `$DSH_HOME/dsh-ninfer/kv`).

## Development

`pnpm install --ignore-scripts`, `pnpm run check`, and `pnpm test`. `scripts/package-custom-engine.py` and the `custom-engine` workflow build the pinned source, verify the patched tree, and publish the relocatable runtime with checksums, source provenance and license notices. `scripts/build-checkpoint-engine.js` is the optional local build path. Automatic installation downloads the published custom binary; it does not compile on the user's computer.

## Portable model configs

Use **Export config** beside a saved model, then **Download config JSON**. The export streams every artifact piece through MD5; large models take time and progress appears in Activity. The JSON includes context, KV format, speculation, vision and checkpoint settings, plus the exact byte size and MD5 of each required piece. Model weights are not included.

Use **Import config**, select that JSON, and enter a model folder. The plugin searches its subfolders, checks exact size before MD5, and rebuilds the artifact’s relative shard layout using links. Renamed or relocated files can be matched. Original weights remain in place. Runtime executables, credentials and machine-specific GPU calibration are not imported; calibrate again on the destination GPU.

Runtime downloads retry three times automatically. Bad checksums discard the damaged part before restarting it; interrupted transfers resume. A failed installation keeps a Retry button visible. Complete verified runtime folders are reused, and incomplete folders are preserved while a replacement is staged.

Recovered configs preserve placement, host cache, graph, draft, output-limit and sampling settings. Cache-stable history uses the bundled template; imported JSON cannot choose a template path or executable. On Blackwell, the automatically installed custom engine supports recovered Q5_1/Q6_0 KV profiles; no executable selection is required. Advanced settings retain an optional executable override for other compatible builds.
