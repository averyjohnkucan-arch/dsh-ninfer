import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cpuLaunch, validateCpuSet } from "../lib/cpu-set.js";

test("CPU sets accept core ranges and reject injected or ambiguous arguments", () => {
  assert.equal(validateCpuSet("0-21"), "0-21");
  assert.equal(validateCpuSet("0-3,8,10-12"), "0-3,8,10-12");
  for (const value of ["--all", "0-21;echo x", "3-1", "0,0", "4096", "1-3,3-4"])
    assert.throws(() => validateCpuSet(value));
  assert.equal(validateCpuSet(undefined), "");
});

test("unrestricted profiles keep the original command and tuned profiles use argv-only taskset", () => {
  assert.deepEqual(cpuLaunch("python3", ["serve.py"]), {
    executable: "python3",
    args: ["serve.py"],
  });
  assert.deepEqual(cpuLaunch("python3", ["serve.py"], "0-21", "linux"), {
    executable: "taskset",
    args: ["--cpu-list", "0-21", "python3", "serve.py"],
  });
  assert.throws(
    () => cpuLaunch("python3", [], "0-21", "win32"),
    /requires Linux/,
  );
});

test(
  "the launched process actually inherits the selected CPU affinity",
  { skip: process.platform !== "linux" },
  () => {
    const available = readFileSync("/proc/self/status", "utf8").match(
      /^Cpus_allowed_list:\s*(.+)$/m,
    )[1];
    const first = available.split(/[-,]/)[0];
    const command = cpuLaunch(
      process.execPath,
      [
        "-e",
        "process.stdout.write(require('fs').readFileSync('/proc/self/status','utf8'))",
      ],
      first,
    );
    const output = execFileSync(command.executable, command.args, {
      encoding: "utf8",
    });
    assert.equal(output.match(/^Cpus_allowed_list:\s*(.+)$/m)[1], first);
  },
);
