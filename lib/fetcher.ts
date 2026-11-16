/** SWR-compatible fetcher: GET a URL and return parsed JSON. */
export const fetcher = (url: string) => fetch(url).then(res => res.json());

export class FetchError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

/** Human-readable message from one of our API error bodies ({ error, code, issues? }). */
function errorMessage(body: any, res: Response): string {
  const issue = Array.isArray(body?.issues) ? body.issues[0] : undefined;
  if (issue?.message) {
    const field = Array.isArray(issue.path) && issue.path.length ? `${issue.path.join('.')}: ` : '';
    return `${field}${issue.message}`;
  }
  const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
  return message || res.statusText || `Request failed (${res.status})`;
}

/** Like `fetcher`, but rejects on non-2xx so SWR reports `error` (e.g. 404) instead of returning the error body. */
export async function strictFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new FetchError(errorMessage(body, res), res.status, body?.code);
  return body as T;
}

/** Send a JSON request and return the parsed response; rejects with a FetchError carrying the server's message. */
export async function sendJson<T = unknown>(
  url: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new FetchError(errorMessage(data, res), res.status, data?.code);
  return data as T;
}
