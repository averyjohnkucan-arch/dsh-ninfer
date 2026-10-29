import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { Runtime } from "../lib/runtime.js";
import { freshProfile } from "../lib/profiles.js";
import { profileFingerprint, speedSettingsKey } from "../lib/speed-test.js";

async function fixture(
  t,
  {
    cached = 0,
    output = 512,
    error = false,
    external = false,
    wait = false,
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "ninfer-speed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    body = JSON.parse(body);
    requests.push({ path: req.url, body, headers: req.headers });
    if (req.url === "/tokenize") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ tokens: Array.from({ length: 3000 }, (_, i) => i) }),
      );
      return;
    }
    if (wait) return;
    res.setHeader("Content-Type", "application/json");
    res.writeHead(error ? 500 : 200);
    res.end(
      JSON.stringify(
        error
          ? { error: { message: "native failure" } }
          : {
              tokens_cached: cached,
              timings: {
                cache_n: cached,
                prompt_n: 2048,
                predicted_n: output,
                prompt_per_second: 143.8,
                predicted_per_second: 66.7,
              },
            },
      ),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const runtime = new Runtime("ninfer", { dataDir: root });
  await runtime.init();
  t.after(() => runtime.dispose());
  const p = freshProfile("ninfer");
  p.modelPath = "/models/weights.ninfer";
  p.context = 8192;
  p.options = { "--kv-dtype": "nvfp4", "--api-key": "fixture-key" };
  const saved = await runtime.save(p);
  const state = {
    url: `http://127.0.0.1:${server.address().port}`,
    ready: true,
    active: 0,
    external,
    kvSession: "previous-chat",
    kvIdentity: "old",
  };
  let released = 0;
  runtime.acquire = async (profile, signal, options) => {
    assert.equal(options.purpose, "speed-test");
    assert.equal(options.reuseExisting, false);
    return { state, signal, release: () => released++ };
  };
  return { runtime, p: saved, state, requests, released: () => released };
}
async function benchmark(runtime, id) {
  const job = await runtime.action("benchmark", { id });
  await runtime.jobs.get(job.id).promise;
  return runtime.jobs.get(job.id);
}

test("one exact uncached 2048/512 test persists rates without changing model/KV settings or server identity", async (t) => {
  const { runtime, p, state, requests, released } = await fixture(t),
    before = profileFingerprint(p);
  const job = await benchmark(runtime, p.id);
  assert.equal(job.status, "complete", job.error);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.parse_special, false);
  const request = requests[1];
  assert.equal(request.path, "/completion");
  assert.equal(request.headers.authorization, "Bearer fixture-key");
  assert.equal(request.body.prompt.length, 2048);
  assert.equal(request.body.prompt[2047], 2047);
  assert.equal(request.body.n_predict, 512);
  assert.equal(request.body.ignore_eos, true);
  assert.equal(request.body.cache_prompt, false);
  assert.equal(request.body.stream, false);
  assert.equal(p.speedTest.prefillTokS, 143.8);
  assert.equal(p.speedTest.decodeTokS, 66.7);
  assert.equal(p.speedTest.promptTokens, 2048);
  assert.equal(p.speedTest.outputTokens, 512);
  assert.equal(profileFingerprint(p), before);
  assert.equal(state.active, 0);
  assert.equal(state.kvSession, null);
  assert.equal(released(), 1);
  assert.equal(runtime.speedTesting, null);
  assert.ok(!JSON.stringify(p.speedTest).includes("fixture-key"));
  const reloaded = new Runtime("ninfer", { dataDir: runtime.root });
  await reloaded.init();
  assert.equal(reloaded.find(p.id).speedTest.decodeTokS, 66.7);
  await reloaded.dispose();
  await runtime.save({ ...p, name: "Renamed model" });
  assert.equal(runtime.find(p.id).speedTest.decodeTokS, 66.7);
  await runtime.save({ ...runtime.find(p.id), context: 16384 });
  assert.equal(runtime.find(p.id).speedTest, undefined);
});

test("cached, shortened and failed native responses retain the last valid result", async (t) => {
  for (const options of [{ cached: 10 }, { output: 8 }, { error: true }]) {
    const { runtime, p } = await fixture(t, options);
    p.speedTest = { prefillTokS: 100, decodeTokS: 50 };
    const previous = p.speedTest;
    const job = await benchmark(runtime, p.id);
    assert.equal(job.status, "failed");
    assert.equal(p.speedTest, previous);
    assert.equal(runtime.speedTesting, null);
  }
});

test("cancellation releases the lease and cache gate, retaining the previous result", async (t) => {
  const { runtime, p, state, requests, released } = await fixture(t, {
    wait: true,
  });
  p.speedTest = { decodeTokS: 60 };
  const { id } = await runtime.action("benchmark", { id: p.id });
  const job = runtime.jobs.get(id);
  while (requests.length < 2) await new Promise((r) => setTimeout(r, 5));
  await runtime.action("cancel", { id });
  await job.promise;
  assert.equal(job.status, "cancelled");
  assert.equal(p.speedTest.decodeTokS, 60);
  assert.equal(state.active, 0);
  assert.equal(released(), 1);
  assert.equal(runtime.speedTesting, null);
  const release = await runtime.cache.gate.acquire(AbortSignal.timeout(100));
  release();
});

test("active answers, insufficient context and external engines are not benchmarked", async (t) => {
  const { runtime, p, state, requests } = await fixture(t);
  runtime.running.set("answering", { active: 1 });
  let job = await benchmark(runtime, p.id);
  assert.equal(job.status, "failed");
  runtime.running.clear();
  p.context = 2048;
  job = await benchmark(runtime, p.id);
  assert.match(job.error, /2,560/);
  p.context = 8192;
  state.external = true;
  job = await benchmark(runtime, p.id);
  assert.match(job.error, /external server was left untouched/);
  assert.equal(requests.length, 0);
});

test("button sits beside calibration, displays rounded rates and saves current settings before starting", async () => {
  const source = await readFile(
    new URL("../client.js", import.meta.url),
    "utf8",
  );
  const p = freshProfile("ninfer");
  p.speedTest = { prefillTokS: 143.8, decodeTokS: 66.7 };
  const states = [
    { profiles: [p], jobs: [], customRuntime: true },
    "editor",
    structuredClone(p),
  ];
  let cursor = 0,
    definition,
    Card;
  const calls = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (states[index] === undefined) states[index] = initial;
      return [
        states[index],
        (value) => {
          states[index] =
            typeof value === "function" ? value(states[index]) : value;
        },
      ];
    },
    useEffect() {},
    createElement(type, props, ...children) {
      return { type, props: props || {}, children };
    },
  };
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(v) {
          definition = v;
        },
      },
    },
    fetch: async (_url, request) => {
      const { action, payload } = JSON.parse(request.body);
      calls.push({ action, payload });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result:
            action === "save"
              ? payload.profile
              : action === "list"
                ? states[0]
                : { id: "job" },
        }),
      };
    },
  });
  definition
    .factory(() => react)
    .apply({
      slots: {
        inject(_, fn) {
          fn();
        },
        register(_, component) {
          Card = component;
        },
      },
    });
  const all = (value) =>
    Array.isArray(value)
      ? value.flatMap(all)
      : !value || typeof value !== "object"
        ? []
        : [value, ...all(value.children)];
  let nodes = all(Card()),
    button = nodes.find(
      (n) => n.type === "button" && n.children[0] === "p144/d67",
    );
  assert.ok(button);
  assert.match(button.props.title, /2,048.*512/);
  const parent = nodes.find((n) => n.children.includes(button));
  assert.ok(
    all(parent).some(
      (n) => n.type === "button" && n.children[0] === "Save and calibrate",
    ),
  );
  states[2].name = "Updated name";
  cursor = 0;
  button = all(Card()).find(
    (n) => n.type === "button" && n.children[0] === "p144/d67",
  );
  await button.props.onClick();
  assert.deepEqual(
    calls.filter((c) => c.action !== "list").map((c) => c.action),
    ["save", "benchmark"],
  );
  assert.equal(states[1], "editor");
  assert.equal(states[2].id, p.id);
  states[2] = { ...p, context: 131072 };
  cursor = 0;
  nodes = all(Card());
  assert.ok(
    nodes.some((n) => n.type === "button" && n.children[0] === "Test speed"),
  );
});

test("speed metadata preserves checkpoint compatibility", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ninfer-speed-cache-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new Runtime("ninfer", { dataDir: root });
  await runtime.init();
  t.after(() => runtime.dispose());
  const p = freshProfile("ninfer");
  p.modelPath = join(root, "model.ninfer");
  await writeFile(p.modelPath, "weights");
  const before = await runtime.cache.identity(p);
  p.speedTest = { prefillTokS: 144, decodeTokS: 67 };
  assert.equal(await runtime.cache.identity(p), before);
});
