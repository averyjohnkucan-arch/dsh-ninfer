import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { Runtime } from "../lib/runtime.js";
import { freshProfile } from "../lib/profiles.js";
import { exportConfig, importConfig } from "../lib/config-transfer.js";

test("config round trip relocates renamed NInfer headers and parts without copying weights", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ninfer-portable-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  await mkdir(source);
  const metadata = {
    metadata: { name: "Fixture" },
    components: {
      text: {
        config: { model_type: "qwen3_5_text", max_position_embeddings: 65536 },
      },
      mtp: {},
    },
    files: [{ path: null }, { path: "original.part" }],
  };
  const payload = Buffer.from(JSON.stringify(metadata)),
    header = Buffer.alloc(32);
  header.write("NINFER\0\x03", 0, "binary");
  header.writeBigUInt64LE(BigInt(payload.length), 8);
  const main = join(source, "model.ninfer");
  await writeFile(main, Buffer.concat([header, payload]));
  await writeFile(join(source, "original.part"), "weight payload");
  const runtime = new Runtime("ninfer", { dataDir: join(root, "data") });
  await runtime.init();
  t.after(() => runtime.dispose());
  const p = {
    ...freshProfile("ninfer"),
    name: "Portable fixture",
    modelPath: main,
    context: 65536,
    options: { "--kv-dtype": "rk4v4", "--spec": "mtp", "--draft-tokens": 3 },
    kvCache: true,
  };
  runtime.profiles = [p];
  const config = await exportConfig(runtime, p.id);
  assert.equal(config.files.length, 2);
  const relocated = join(root, "relocated", "nested");
  await mkdir(relocated, { recursive: true });
  await rename(main, join(relocated, "renamed.ninfer"));
  await rename(join(source, "original.part"), join(relocated, "renamed.part"));
  const result = await importConfig(runtime, config, join(root, "relocated"));
  const restored = runtime.find(result.ids[0]);
  assert.equal(restored.name, p.name);
  assert.equal(restored.context, 65536);
  assert.deepEqual(restored.options, p.options);
  assert.equal(restored.kvCache, true);
  assert.equal(
    await readFile(join(dirname(restored.modelPath), "original.part"), "utf8"),
    "weight payload",
  );
  const inspection = await runtime.action("assign", {
    paths: [restored.modelPath],
  });
  assert.equal(inspection.complete, true);
  assert.ok(inspection.files[0].components.includes("mtp"));
  config.settings.options["--chat-template"] = "/tmp/execute";
  await assert.rejects(
    () => importConfig(runtime, config, join(root, "relocated")),
    /advanced option/,
  );
});

test("recovered tuning controls and bundled conversation template survive export and import", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ninfer-recovered-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { cacheHistoryTemplate } = await import("../lib/cache-history.js");
  const manifest = { components: { text: { config: { max_position_embeddings: 262144 } } }, files: [] };
  const payload = Buffer.from(JSON.stringify(manifest)), header = Buffer.alloc(32);
  header.write("NINFER\0\x03", 0, "binary");
  header.writeBigUInt64LE(BigInt(payload.length), 8);
  const main = join(root, "nvfp4.ninfer");
  await writeFile(main, Buffer.concat([header, payload]));
  const runtime = new Runtime("ninfer", { dataDir: join(root, "data") });
  await runtime.init();
  t.after(() => runtime.dispose());
  const p = {
    ...freshProfile("ninfer"), modelPath: main, context: 196608, cacheStableHistory: true,
    maxTokens: 32768, samplingPresets: { thinking: { temperature: 1, top_p: 0.95 } },
    options: { "--kv-dtype": "q5_1", "--vision-residency": "resident",
      "--embedding-residency": "device", "--output-head-residency": "device",
      "--host-cache-mib": "16384", "--structured-output": true,
      "--full-draft-head": true, "--no-cuda-graph": true, "--device-state-slots": "0",
      "--chat-template": cacheHistoryTemplate, "--preserve-thinking": true },
  };
  runtime.profiles = [p];
  const config = await exportConfig(runtime, p.id);
  assert.equal(config.settings.options["--chat-template"], undefined);
  const result = await importConfig(runtime, config, root);
  const restored = runtime.find(result.ids[0]);
  assert.deepEqual(restored.options, p.options);
  assert.deepEqual(restored.samplingPresets, p.samplingPresets);
  assert.equal(restored.maxTokens, 32768);
  assert.equal(restored.cacheStableHistory, true);
  assert.equal(restored.runtimeNotice, undefined);
  config.settings.options["--chat-template"] = "/arbitrary/template";
  await assert.rejects(() => importConfig(runtime, config, root), /advanced option/);
});
