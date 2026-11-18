import { readFileSync } from "node:fs";
import { cpus } from "node:os";

/** CPU affinity belongs to the whole server tree, including its CUDA helpers and vision encoder. */
export function validateCpuSet(value) {
  if (value === undefined || value === "") return "";
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value)
  )
    throw new Error(
      "CPU set must contain core numbers or ranges, such as 0-21",
    );
  const seen = new Set();
  for (const range of value.split(",")) {
    const [start, end = start] = range.split("-").map(Number);
    if (start > end || end > 4095) throw new Error("Invalid CPU range");
    for (let cpu = start; cpu <= end; cpu++) {
      if (seen.has(cpu)) throw new Error("Duplicate CPU in set");
      seen.add(cpu);
    }
  }
  return value;
}

export function cpuLaunch(
  executable,
  args,
  cpuSet,
  platform = process.platform,
) {
  const cores = validateCpuSet(cpuSet);
  if (!cores) return { executable, args };
  if (platform !== "linux")
    throw new Error(
      "This tuned CPU set requires Linux; clear cpuSet on this system",
    );
  return {
    executable: "taskset",
    args: ["--cpu-list", cores, executable, ...args],
  };
}

/** Linux affinity is authoritative; containers may expose non-contiguous CPU IDs. */
export function availableCpuIds(platform = process.platform) {
  if (platform === "linux") {
    const status = readFileSync("/proc/self/status", "utf8");
    const list = status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
    if (!list) throw new Error("Could not determine available CPUs");
    return expandCpuSet(list);
  }
  return cpus().map((_cpu, index) => index);
}

function expandCpuSet(value) {
  validateCpuSet(value);
  return value.split(",").flatMap((range) => {
    const [start, end = start] = range.split("-").map(Number);
    return Array.from(
      { length: end - start + 1 },
      (_value, index) => start + index,
    );
  });
}

function formatCpuSet(ids) {
  const ranges = [];
  for (let index = 0; index < ids.length; index++) {
    const start = ids[index];
    let end = start;
    while (ids[index + 1] === end + 1) end = ids[++index];
    ranges.push(start === end ? String(start) : `${start}-${end}`);
  }
  return ranges.join(",");
}

export function cpuBudget(coresKeptFree = 0, available = availableCpuIds()) {
  if (
    !Number.isInteger(coresKeptFree) ||
    coresKeptFree < 0 ||
    coresKeptFree >= available.length
  )
    throw new Error(
      `Cores kept free must be a whole number from 0 to ${available.length - 1}`,
    );
  const selected = available.slice(0, available.length - coresKeptFree);
  return {
    available: available.length,
    coresKeptFree,
    limit: selected.length,
    cpuSet: formatCpuSet(selected),
  };
}

/** Reserve from the host-wide available set, then respect any narrower saved model affinity. */
export function reservedCpuSet(
  cpuSet,
  coresKeptFree = 0,
  available = availableCpuIds(),
) {
  const budget = cpuBudget(coresKeptFree, available);
  const explicit = validateCpuSet(cpuSet);
  if (!coresKeptFree) return explicit;
  const allowed = new Set(expandCpuSet(budget.cpuSet));
  const selected = explicit
    ? expandCpuSet(explicit).filter((cpu) => allowed.has(cpu))
    : [...allowed];
  if (!selected.length)
    throw new Error(
      "The saved model CPU set does not overlap the CPUs allowed by Cores kept free",
    );
  return formatCpuSet(selected);
}
