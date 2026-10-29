import test from "node:test";
import assert from "node:assert/strict";
import { gpuOperation } from "../lib/gpu-operation.js";
const profile = { id: "n", name: "NInfer", gpu: 0 };
test("calibration releases shared GPU admission on success, failure and cancellation", async () => {
  for (const fail of [false, true]) {
    const events = [],
      controller = new AbortController();
    const runtime = {
      running: new Map(),
      scheduler: {
        async acquire(driver) {
          assert.equal(driver.gpu, 0);
          await driver.load();
          return {
            signal: controller.signal,
            release: () => events.push("release"),
          };
        },
        async unload(key) {
          events.push(key);
        },
      },
    };
    const result = gpuOperation(runtime, profile, undefined, async (signal) => {
      assert.equal(signal, controller.signal);
      if (fail) {
        controller.abort();
        signal.throwIfAborted();
      }
      return 42;
    });
    if (fail) await assert.rejects(result, { name: "AbortError" });
    else assert.equal(await result, 42);
    assert.deepEqual(events, ["release", "ninfer:calibrate:n"]);
  }
});
test("server-free calibration unloads only idle owned servers on its GPU", async () => {
  const events = [],
    runtime = {
      running: new Map([
        ["a", { profile: { gpu: 0 } }],
        ["b", { profile: { gpu: 1 } }],
      ]),
      async stopLocal(id) {
        events.push(id);
      },
    };
  await gpuOperation(runtime, profile, undefined, async () =>
    events.push("calibrate"),
  );
  assert.deepEqual(events, ["a", "calibrate"]);
  runtime.running.set("a", { profile: { gpu: 0 }, active: 1 });
  await assert.rejects(
    gpuOperation(runtime, profile, undefined, async () => {}),
    /active answer/,
  );
  runtime.running.set("a", { profile: { gpu: 0 }, external: true });
  await assert.rejects(
    gpuOperation(runtime, profile, undefined, async () => {}),
    /externally managed/,
  );
});
