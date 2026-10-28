import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { exportManifest, locateFiles, validateManifest } from "./portable.js";
import { freshProfile, normalizeProfile } from "./profiles.js";

const flags = new Set([
  "--kv-dtype",
  "--kv-capacity",
  "--max-concurrency",
  "--spec",
  "--draft-tokens",
  "--lm-head-draft",
  "--embedding-q4",
  "--gdn-state-fp16",
  "--prefill-cublas",
  "--prefill-chunk",
  "--ngram-draft-tokens",
  "--vision",
]);
function portableOptions(options) {
  const result = {};
  for (const [flag, value] of Object.entries(options || {})) {
    if (["--host", "--port", "--model-id"].includes(flag)) continue;
    if (
      !flags.has(flag) ||
      !["string", "number", "boolean"].includes(typeof value) ||
      String(value).length > 64 ||
      /[/\\\0]/.test(String(value))
    )
      throw Error(
        "This portable config cannot include the advanced option " + flag,
      );
    result[flag] = value;
  }
  return result;
}

export async function exportConfig(runtime, id, signal, report) {
  const p = runtime.find(id),
    inspection = await runtime.action("assign", { paths: [p.modelPath] });
  if (!inspection.complete) throw Error(inspection.warnings.join(" "));
  const model = inspection.files.find((file) => file.kind === "ninfer");
  if (!model) throw Error("Choose a NInfer artifact");
  const entries = [
    { role: "model", path: p.modelPath },
    ...model.parts.map((path) => ({
      role: "part",
      path,
      relative: relative(dirname(p.modelPath), path).split("\\").join("/"),
    })),
  ];
  return exportManifest(
    "ninfer",
    p.name,
    {
      context: p.context,
      gpu: p.gpu,
      kvCache: p.kvCache === true,
      options: portableOptions(p.options),
    },
    entries,
    { signal, report },
  );
}

export async function importConfig(runtime, value, root, signal, report) {
  const manifest = validateManifest(value, "ninfer");
  const files = await locateFiles(manifest, root, { signal, report });
  if (
    files.filter((file) => file.role === "model").length !== 1 ||
    files.some((file) => !["model", "part"].includes(file.role))
  )
    throw Error("NInfer config must contain one header and its artifact parts");
  await mkdir(join(runtime.root, "imports"), { recursive: true });
  const directory = await mkdtemp(join(runtime.root, "imports", "config-"));
  try {
    const main = files.find((file) => file.role === "model");
    for (const file of files) {
      const path = join(
        directory,
        file.role === "model" ? main.name : file.relative || file.name,
      );
      await mkdir(dirname(path), { recursive: true });
      await symlink(file.path, path);
    }
    const inspection = await runtime.action("assign", {
      paths: [join(directory, main.name)],
    });
    if (!inspection.complete) throw Error(inspection.warnings.join(" "));
    const model = inspection.files.find((file) => file.kind === "ninfer");
    // Inspect the linked header so its relative shard references are checked at their new location.
    const expected = new Set(
      files
        .filter((file) => file.role === "part")
        .map((file) => join(directory, file.relative || file.name)),
    );
    if (
      model.parts.some((path) => !expected.has(path)) ||
      expected.size !== model.parts.length
    )
      throw Error("Config parts do not match the NInfer header");
    const p = {
      ...freshProfile("ninfer"),
      ...inspection.assignments,
      name: manifest.name,
      context: manifest.settings.context,
      gpu: manifest.settings.gpu ?? 0,
      kvCache: manifest.settings.kvCache === true,
      nativeContext: model.nativeContext,
      components: model.components,
      options: portableOptions(manifest.settings.options),
    };
    delete p.suggestedName;
    while (runtime.profiles.some((other) => other.port === p.port)) p.port++;
    const validated = normalizeProfile(p, "ninfer");
    signal?.throwIfAborted();
    const previous = runtime.profiles;
    const next = [...previous, validated];
    runtime.profiles = next;
    try {
      await runtime.persist();
    } catch (error) {
      if (runtime.profiles === next) runtime.profiles = previous;
      throw error;
    }
    runtime.onChange();
    return { ids: [validated.id], files: files.length };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
