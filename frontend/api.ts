export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface ApiOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
}
const messages: Record<number, string> = {
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  409: 'This resource changed. Refresh and try again.',
  429: 'Too many requests. Please wait before trying again.',
};
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  options: ApiOptions = {},
): Promise<T> {
  const retries = method === 'GET' ? (options.retries ?? 1) : 0;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    const timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      options.timeoutMs ?? (method === 'GET' ? 15000 : 30000),
    );
    try {
      const response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        signal: controller.signal,
        headers:
          body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 204) return undefined as T;
      const raw = await response.text();
      let data: { error?: string } | undefined;
      if (
        response.headers.get('content-type')?.includes('application/json') &&
        raw
      ) {
        try {
          data = JSON.parse(raw);
        } catch {
          /* handled below */
        }
      }
      if (!response.ok)
        throw new ApiError(
          response.status,
          (response.status !== 401 &&
          response.status < 500 &&
          typeof data?.error === 'string'
            ? data.error
            : undefined) ??
            messages[response.status] ??
            'The server is temporarily unavailable.',
        );
      if (!data)
        throw new ApiError(
          502,
          'The server returned an unexpected response. Please try again.',
        );
      return data as T;
    } catch (error) {
      if (options.signal?.aborted)
        throw new DOMException('Request cancelled.', 'AbortError');
      const failure =
        error instanceof ApiError
          ? error
          : new ApiError(
              0,
              timedOut
                ? method === 'GET'
                  ? 'The request timed out. Please try again.'
                  : 'The request timed out. The change may have saved; refresh before trying again.'
                : 'Connection lost. Check your internet connection.',
            );
      if (attempt >= retries || (failure.status !== 0 && failure.status < 500))
        throw failure;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    if (options.signal?.aborted)
      throw new DOMException('Request cancelled.', 'AbortError');
  }
}
