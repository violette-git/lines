export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type AiErrorCode =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'overloaded'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'too_large'
  | 'server'
  | 'bad_response';

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: AiErrorCode,
    readonly status: number | null = null,
    /** True when retrying later may succeed. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export const DEFAULT_TIMEOUT_MS = 60_000;

/** fetch with an AbortController timeout. Converts aborts and network failures into AiError. */
export async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  label = 'AI service',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
      throw new AiError(`${label} did not respond within ${Math.round(timeoutMs / 1000)}s. Check signal and try again.`, 'timeout', null, true);
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new AiError(`Network error contacting ${label}: ${msg}`, 'network', null, true);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads a response body as JSON, returning null when it is empty or not JSON. */
export async function readJson(res: Response): Promise<unknown> {
  let text = '';
  try {
    text = await res.text();
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _text: text.slice(0, 300) };
  }
}
