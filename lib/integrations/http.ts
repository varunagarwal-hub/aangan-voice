export class HttpError extends Error {
  constructor(public status: number, public body: string, public url: string) {
    super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 300)}`);
  }
}

/** fetch with a timeout and JSON handling. Throws HttpError on non-2xx. */
export async function fetchJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 8000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, text, url);
  return (text ? JSON.parse(text) : {}) as T;
}
