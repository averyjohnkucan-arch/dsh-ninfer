/** Reserve the same GPU queue as chat while running a server-free native operation. */
export async function gpuOperation(runtime, profile, signal, operation) {
  const stopOwned = async () => {
    for (const [id, state] of runtime.running) {
      if (state.profile.gpu !== profile.gpu) continue;
      if (state.active)
        throw Error("Wait for the active answer before calibrating.");
      if (state.external)
        throw Error("Stop the externally managed server before calibrating.");
      await runtime.stopLocal(id);
    }
    return {};
  };
  const scheduler = runtime.scheduler;
  if (!scheduler) {
    await stopOwned();
    return operation(signal);
  }
  const key = "ninfer:calibrate:" + profile.id;
  const lease = await scheduler.acquire(
    {
      key,
      name: "Calibrate " + profile.name,
      gpu: profile.gpu,
      fingerprint: key,
      load: stopOwned,
      unload: async () => {},
    },
    signal,
  );
  try {
    return await operation(lease.signal);
  } finally {
    lease.release();
    await scheduler.unload(key);
  }
}
