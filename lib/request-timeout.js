/** Local prefill and checkpoint preparation may be silent for hours. */
export const DEFAULT_REQUEST_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const MAX_REQUEST_IDLE_TIMEOUT_MS = 2147483647;
/** Resolve the deployment idle interval; queue admission has no deadline. */
export function requestIdleTimeoutMs(config = {}) {
 const value = config.requestIdleTimeoutMs ?? DEFAULT_REQUEST_IDLE_TIMEOUT_MS;
 if (!Number.isInteger(value) || value <= 0 || value > MAX_REQUEST_IDLE_TIMEOUT_MS)
  throw new Error('requestIdleTimeoutMs must be a positive integer no greater than 2147483647.');
 return value;
}
