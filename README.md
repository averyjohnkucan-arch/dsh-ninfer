# NInfer for DeepSeek Harness

Manage local NInfer models and editable server profiles inside DSH. Includes the supplied Qwen3.8 27B 262k reference configuration.

## Install in DSH

Requires DeepSeek Harness **0.2.1-rc.2**, running its Web profile.

1. Open **Plugins → Add plugin → GitHub**.
2. Paste `https://github.com/averyjohnkucan-arch/dsh-ninfer`.
3. Install and enable the plugin. Reload the browser, or restart DSH if its manager requests it.
4. Open **Settings → Models → NInfer**.

The plugin is a ready-to-install Cordis bundle. It does not patch DSH, replace its UI, install a second DSH, or require a plugin compilation step. Its package uses DSH's shipped peers, so installation does not download another provider stack or ask to run provider dependency build scripts.

## Models

Choose **Add model**, then **Select model files**. Browse the host's model directory and select multiple files, or **Select all model files here**. You can navigate between directories while retaining the selection. **Inspect and assign** reads headers and assigns the main model, its ordered shards, the vision projector and MTP. It reports missing shards, mixed main-model sets and unsupported MTP formats.

Edit the profile and save. **Start** prepares a missing runtime/model pack before starting the server. Runtime installation and model preparation show progress and can be cancelled. Existing installed engines and prepared packs can be selected under **Runtime and imported model data**. The model becomes available in DSH's conversation model picker after saving.

**Edit** reopens a saved profile. **Remove profile** deletes its saved configuration and stops its owned process; downloaded model files are retained. **Attach running server** explicitly connects to an already-running server advertising the profile's model ID. Stopping or disabling an attachment only detaches; it never terminates the external process. Launch settings are not applied to an external server.

All documented inference flags from the pinned executable's help have controls under **All engine CLI options**. Blank means the engine default; boolean **Omit flag** means the flag is not passed, not that an engine-default feature is necessarily disabled. The complete JSON editor supports repeated flags as arrays and multi-value flags as `{"argv":["first","second"]}`. Additional argv is an array, never a shell string. Environment variables and the complete server configuration are also editable.

## Updates, disable and removal

Update each repository independently through DSH's plugin manager. Turn its switch off to remove its card, provider registration and tools, and stop the servers it owns. Remove the bundle to uninstall its code. Saved profiles and runtime data remain in `~/.dsh/dsh-ninfer/` (or `$DSH_HOME/dsh-ninfer/`) so reinstalling restores them. Delete that plugin-owned data directory separately if you want a complete reset. Neither plugin requires the other.

## Integration

The package declares `dsh.bundle.patch` and `dsh.client`; the patch inserts only its own Cordis row. The client registers React UI through the documented `settings.models.footer` slot and uses DSH theme tokens and locale service. The Host registers an `LlmAdapter` through `ctx.llm.registerAdapter`, delegates wire conversion, images and replay to DSH's public `PiAiAdapter`, and owns a separate `ctx.webServer.register` route. An ephemeral bearer capability supplied through `webserver/index-inject` protects its JSON actions. There is no iframe, DOM injection or replacement of built-in provider cards.

Registrations and process lifetimes are owned by `ctx.effect`/`ctx.on`. The agent-facing `ninfer_models` tool uses the same operations as the card and DSH's `approveEscalation` mechanism; host-management calls require Full access or explicit per-call approval. UI actions require the owner's page capability. This initial version targets the local Web profile; remote delegated access and Electron-only profiles have not been validated.

## Development

```sh
pnpm install --ignore-scripts
pnpm test
pnpm run check
```

Node 22.19+ is required. Development provider dependencies may report skipped optional install scripts; the published plugin has no install scripts and consumes DSH's installed peer packages. The two repositories contain their own code and tests and can be developed separately.

## NInfer runtime

Engine: [iamwavecut/ninfer-all](https://github.com/iamwavecut/ninfer-all), tested source revision `5ed86dff9fe3a5a0776f40a7aea86cf381da990d`.

The runtime installer builds the pinned upstream source with the engine patch shipped in `patches/ninfer-dflash-checkpoints.patch`. The patch adds native DFlash/DFlash2 disk snapshots, including draft-cache frontier metadata and reusable system-prefix anchors. It does not modify DSH. Existing profiles and binaries are not silently replaced.

Build prerequisites are Git, CMake 3.24+, Ninja, a compatible C++ compiler, CUDA 13.1 (including NVTX3 headers), and FFmpeg/cURL development packages. The default target is Linux x86_64 Blackwell `sm120a`. To select another supported GPU architecture or toolchain:

```sh
CMAKE=/path/to/cmake npm run build:checkpoints -- --root /path/to/runtime --arch 120a --jobs 8
```

`NINFER_CMAKE_ARGS` accepts a JSON array of additional CMake arguments. The build writes `checkpoint-build.json` with the upstream revision and patch hash. Select the resulting `build/apps/ninfer-serve` executable in the profile. The optional `scripts/fetch-ninfer.py` still fetches the pinned stock OCI binary; that stock binary does **not** support DFlash disk checkpoints. Model weights remain external.

NInfer consumes `.ninfer` artifacts. GGUF-to-NInfer conversion is not implemented by this plugin. NInfer's server flags, calibration action, environment and optional temporary power-profile hold are exposed. Calibration is user-triggered and saves its profile path. There is no automatic tuning in this plugin.

## Included Qwen3.8 27B reference profile

The initial profile preserves the owner's supplied setup:

```text
--max-context 262144 --kv-capacity 262144 --max-concurrency 1
--kv-dtype rk4v4 --spec dflash2 --draft-tokens 7 --lm-head-draft
--embedding-q4 --gdn-state-fp16 --prefill-cublas --prefill-chunk 512
--ngram-draft-tokens 0
```

It uses model ID `qwen3.8-27b`, port 8188, text-only input, a performance power-profile hold, and the supplied environment/calibration paths. The owner's absolute paths are an editable reference; other installations must select their own downloaded artifact and runtime libraries.

Model: [neroued/Qwen3.8-27B-NInfer](https://huggingface.co/neroued/Qwen3.8-27B-NInfer), revision `1cbd84e7221e51186bd7f093a149912d2489625b`, supplied SHA-256 `81f924d440c27261d820c19a9f8d45794c5aee410f8a68bd358133fa8c0375da`.

The reported benchmark numbers belong to the owner's prior run and are not claimed as a new plugin benchmark. No model inference or calibration was rerun while importing this profile. Reinstalling the plugin retains edited profiles; the seed is created only when no profile store exists.

When Start or a chat finds an existing server on the saved port, it automatically reuses it only if `/v1/models` advertises the exact saved model ID. The plugin never takes ownership of that process: Stop detaches, and saved launch changes require restarting the external server yourself. A different model, an invalid response, or an authenticated server without matching credentials is rejected. Strata tuning requires a plugin-owned server and never reuses an external process.

## Per-model reasoning settings

Edit a model profile to add/remove reasoning levels, give each a display name,
and set the exact `reasoning_effort` backend value. Choose a default level, or
Engine default to leave the request unspecified. Custom names and values are
supported; availability is declared per profile, not assumed for every model.
The engine/template must accept the configured backend values.

Qwen3.8 profiles start with Off (thinking disabled), Low → `low`, Medium → `medium`, and XHigh → `xhigh`,
with Medium as default. The conversation model picker uses these profile-owned
settings through DSH's existing adapter reasoning metadata. No DSH core patch
is required. An empty level list hides the reasoning selector for that profile.

## Model Scheduler integration

Optionally install `dsh-model-scheduler` for shared GPU admission, queued chat switching, manual load/unload and separate configurable idle retention (five minutes by default) and switch grace (30 seconds by default). This provider remains independently usable. Scheduling policy lives in that separate Cordis service; no Harness core changes are required. Owned engine process groups are stopped before GPU release is reported. External servers are detached, never killed.

## Per-chat checkpoints and shared prefixes

The per-profile **Keep model loaded while idle** setting (`keepWarm: true`) preserves the running engine and its in-memory cache when the optional Model Scheduler is installed. Another queued model, image job, manual Unload or shutdown can still release it. Other profiles retain their normal idle timer.

For the qualified Qwen3.8 profile, `cacheStableHistory: true` enables positional system and tool updates through the public provider adapter. It requires `--chat-template` to point to this plugin's `assets/qwen3_8-cache.jinja` and `--preserve-thinking: true`. The external template derives from the pinned upstream Qwen3.8 template; stock NInfer remains unchanged. Tool declarations stay at their history positions while the full catalog remains available to the server for tool validation.

This processes new user text after Send. It does not process drafts or generate background answers. Changing the template requires a one-time cache rebuild. Cold loads, history edits, compaction, reasoning changes and non-additive tool changes can still require recomputation. Do not enable this template on unrelated model families without validation.

With the patched engine selected, enable **Save per-chat KV checkpoints**. The provider serializes restore → inference → save through its official DSH adapter. Every successfully completed inference step (including tool calls and token-limit stops) publishes a durable native checkpoint. Interrupted or failed steps retain the preceding valid checkpoint. Each chat retains its two most recently used model configurations. Auxiliary summarization/title calls and externally attached servers do not write checkpoints.

Checkpoints live in the plugin data directory under `kv/chats/`, with hashed chat IDs, private file permissions, atomic manifests, and compatibility fingerprints covering weights, executable and launch settings. Their contents include conversation state; treat this directory as private chat data. A missing, incompatible or corrupt checkpoint falls back to normal prefill and exposes a warning in model status.

When switching chats, the provider first checks for a compatible continuation still resident in the native GPU/host cache. Otherwise it restores a snapshot from disk. New chats may restore a matching previous checkpoint, but native token-prefix validation and explicit system/tool anchors restrict reuse to the identical prefix; another chat's user/assistant content is not added to the request. Edits and compaction recompute from the last compatible native anchor, which may precede the exact edit position.

The patch uses NInfer's original checkpoint catalog (`--slot-save-path`), because its alternate hybrid cache does not expose native snapshots. The plugin manages that directory and rejects conflicting cache flags. It defaults to eight private anchors per continuation and an 8 GiB host-cache budget; explicit profile values take precedence. Smaller budgets can fail startup when the recurrent-state images exceed the engine's allocation limit. This path can have different memory/performance characteristics from stock DFlash2 caching. Snapshots are native full snapshots, not incremental deltas; long contexts can require substantial disk space and write bandwidth. Same-model resident reuse avoids reloading weights, but disk transfers and different-model loads are not guaranteed to finish in one or two seconds. See [measured checkpoint validation](docs/CHECKPOINT-VALIDATION.md) for the tested configuration and limitations.

The **Off** reasoning level disables thinking with `chat_template_kwargs.enable_thinking=false`; it does not send the literal `off` as an unsupported reasoning-effort value. Existing version-1 model profiles gain Off once on upgrade; custom names and Medium defaults are preserved. Set a custom row's backend value to `off` for the same behavior.

To qualify the native checkpoint path on your model, start a managed checkpoint-enabled server and run `python3 scripts/verify-checkpoints.py capture --url http://127.0.0.1:PORT --model MODEL --report REPORT.json`. Restart that server, run the same command with `restore`, then restart and run it with `cold`. The script compares restored continuation against uninterrupted greedy output, checks actual native cached-token counts, and compares shared-prefix reuse against a cold new chat. It writes one test snapshot named `dsh-qualification.kv`; use a dedicated test profile. This requires real model weights and GPU access; the ordinary plugin tests do not substitute for it.
