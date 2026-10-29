import { createHash } from "node:crypto";

export const speedTestFields = [
  "modelPath",
  "modelFiles",
  "context",
  "gpu",
  "executable",
  "options",
  "environment",
  "extraArgs",
  "powerProfile",
  "kvCache",
  "tuned",
  "locks",
];
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
}
/** Keep credentials out of the measurement receipt while detecting changed execution settings. */
export function speedSettingsKey(profile) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        ordered(
          Object.fromEntries(speedTestFields.map((key) => [key, profile[key]])),
        ),
      ),
    )
    .digest("hex");
}
/** Measurement metadata must not change a running server's configuration identity. */
export function profileFingerprint(profile) {
  const { speedTest, ...configuration } = profile;
  return JSON.stringify(configuration);
}

const paragraphs = [
  "CPU caches exploit temporal and spatial locality. Cache lines bring nearby data into fast memory; associativity and replacement policy determine which lines remain resident.",
  "Database indexes trade storage and update work for faster lookups. Query plans combine filters, joins and ordered scans, while transaction logs support recovery after interruption.",
  "Network protocols balance latency and throughput using packet windows, acknowledgments and congestion control. Measurements should separate connection setup from sustained transfers.",
  "Reliable experiments document their inputs, units and measurement procedure. Repeating a workload under the same conditions makes differences easier to interpret.",
  "Operating systems schedule runnable tasks and manage virtual memory. Page tables map addresses, and page caches retain recently accessed file contents.",
  "Parallel programs divide work among processors. Synchronization, memory bandwidth and uneven workloads can limit speed even when additional compute units are available.",
];
const corpus = Array.from(
  { length: 128 },
  (_, i) =>
    `Reference ${i + 1}: ${paragraphs[i % paragraphs.length]} Record identifier ${(i * 7919 + 104729) % 1000003}.`,
).join("\n");

/** One uncached raw completion: exact token IDs avoid chat-template overhead and tokenizer estimates. */
export async function testSpeed(runtime, id, signal, report) {
  const profile = structuredClone(runtime.find(id));
  if (profile.context < 2560)
    throw Error(
      "The speed test needs at least 2,560 tokens of context (2,048 input + 512 output).",
    );
  if (runtime.speedTesting) throw Error("Another speed test is running.");
  if ([...runtime.running.values()].some((state) => state.active > 0))
    throw Error("Wait for the active answer before testing speed.");
  if (
    [...runtime.jobs.values()].some(
      (job) =>
        job.status === "running" &&
        job.profileId !== id &&
        ["Calibrate GPU", "prepare-start", "start", "setup"].includes(job.kind),
    )
  )
    throw Error("Wait for the other GPU operation before testing speed.");
  runtime.speedTesting = id;
  let release,
    lease,
    state,
    entered = false;
  try {
    signal.throwIfAborted();
    report("Loading saved model settings…");
    lease = await runtime.acquire(profile, signal, {
      purpose: "speed-test",
      reuseExisting: false,
    });
    signal = lease.signal || signal;
    release = await runtime.cache.gate.acquire(signal);
    signal.throwIfAborted();
    state = lease.state;
    if (state.external)
      throw Error(
        "The speed test requires a plugin-owned engine. The external server was left untouched.",
      );
    state.active = (state.active || 0) + 1;
    entered = true;
    const post = async (path, body) => {
      const response = await fetch(state.url + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...runtime.serverHeaders(profile),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(180000)]),
      });
      const value = await response.json();
      if (!response.ok)
        throw Error(
          value.error?.message ||
            value.error ||
            `Speed test request failed (${response.status}).`,
        );
      return value;
    };
    report("Preparing exactly 2,048 input tokens…");
    const { tokens } = await post("/tokenize", {
      content: corpus,
      add_special: false,
      parse_special: false,
    });
    if (
      !Array.isArray(tokens) ||
      tokens.length < 2048 ||
      tokens.some((token) => !Number.isInteger(token) || token < 0)
    )
      throw Error("The engine did not return enough valid prompt tokens.");
    report("Measuring 2,048-token prefill and 512-token decode…");
    const started = Date.now();
    const result = await post("/completion", {
      prompt: tokens.slice(0, 2048),
      n_predict: 512,
      ignore_eos: true,
      cache_prompt: false,
      temperature: 0,
      stream: false,
    });
    const timings = result.timings;
    if (
      timings?.prompt_n !== 2048 ||
      timings?.predicted_n !== 512 ||
      (result.tokens_cached ?? timings.cache_n ?? 0) !== 0
    )
      throw Error(
        "The engine did not complete an uncached 2,048-input / 512-output test. Previous measurement kept.",
      );
    if (
      !Number.isFinite(timings.prompt_per_second) ||
      timings.prompt_per_second <= 0 ||
      !Number.isFinite(timings.predicted_per_second) ||
      timings.predicted_per_second <= 0
    )
      throw Error("The engine did not report valid prefill/decode rates.");
    signal.throwIfAborted();
    const measurement = {
      prefillTokS: timings.prompt_per_second,
      decodeTokS: timings.predicted_per_second,
      promptTokens: 2048,
      outputTokens: 512,
      measuredAt: new Date().toISOString(),
      wallMs: Date.now() - started,
      settingsKey: speedSettingsKey(profile),
    };
    const saved = runtime.find(id),
      previous = saved.speedTest;
    saved.speedTest = measurement;
    try {
      await runtime.persist();
    } catch (error) {
      if (previous === undefined) delete saved.speedTest;
      else saved.speedTest = previous;
      throw error;
    }
    report(
      `p${Math.round(measurement.prefillTokS)}/d${Math.round(measurement.decodeTokS)}`,
    );
    return measurement;
  } finally {
    if (entered) {
      state.active = Math.max(0, state.active - 1);
      state.kvSession = null;
      state.kvIdentity = null;
    }
    release?.();
    lease?.release();
    runtime.speedTesting = null;
  }
}
