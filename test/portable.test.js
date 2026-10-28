import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exportManifest,
  locateFiles,
  validateManifest,
  fileMd5,
} from "../lib/portable.js";

test("portable configs find renamed pieces recursively by size then MD5", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "portable-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = join(root, "original.bin");
  await writeFile(original, "model bytes");
  const config = await exportManifest("test", "A model", { context: 65536 }, [
    { role: "model", path: original },
  ]);
  assert.equal(config.files[0].md5.length, 32);
  const nested = join(root, "models", "nested");
  await mkdir(nested, { recursive: true });
  const moved = join(nested, "renamed.bin");
  await rename(original, moved);
  await writeFile(join(nested, "decoy.bin"), "wrong bytes");
  await writeFile(join(nested, "different-size.bin"), "ignore");
  await symlink(join(root, "models"), join(nested, "loop"));
  const progress = [];
  const found = await locateFiles(config, join(root, "models"), {
    report: (text) => progress.push(text),
  });
  assert.equal(found[0].path, moved);
  assert.ok(!progress.some((text) => text.includes("different-size.bin")));
  const wrong = structuredClone(config);
  wrong.files[0].md5 = "0".repeat(32);
  await assert.rejects(
    () => locateFiles(wrong, join(root, "models")),
    /No exact size and MD5 match/,
  );
  await assert.rejects(() => locateFiles(config, "/"), /model folder/);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    () => fileMd5(moved, { signal: aborted.signal }),
    /abort/i,
  );
});

test("configs reject another engine and unsafe shard paths", () => {
  const config = {
    format: "dsh-local-model",
    version: 1,
    engine: "strata",
    name: "Test",
    settings: {},
    files: [
      {
        id: "0",
        role: "model",
        name: "model.gguf",
        size: 1,
        md5: "a".repeat(32),
      },
    ],
  };
  assert.throws(() => validateManifest(config, "ninfer"), /portable ninfer/);
  config.files[0].relative = "../outside";
  assert.throws(() => validateManifest(config, "strata"), /Unsafe relative/);
  delete config.files[0].relative;
  config.files[0].name = "..";
  assert.throws(
    () => validateManifest(config, "strata"),
    /Invalid file identity/,
  );
});
