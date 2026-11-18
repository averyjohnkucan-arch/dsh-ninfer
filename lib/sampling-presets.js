/** Fill omitted request controls from the selected reasoning-mode preset. Explicit request fields win. */
export function samplingPayload(profile, effort, payload = {}, { ninfer = false } = {}) {
  const mode = ["off", "none"].includes(effort) ? "instruct" : "thinking";
  const preset = profile.samplingPresets?.[mode];
  if (!preset) return {};
  const fields = ["temperature", "top_p", "top_k", "min_p", "presence_penalty", "frequency_penalty", ...(ninfer ? [] : ["repetition_penalty", "penalty_last_n"])];
  const defaults = {};
  for (const field of fields) {
    const value = preset[field];
    if (payload[field] == null && typeof value === "number" && Number.isFinite(value)) defaults[field] = value;
  }
  return defaults;
}
