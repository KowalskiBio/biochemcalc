/**
 * Low-level HTTP client for the biochemcalc backend, replacing Tauri's
 * `invoke()`. The server responds with the raw value on success, or a
 * `{"kind": "...", "message": "..."}` JSON body on failure (see the Rust
 * `DbError` serialization in `src-tauri/src/db/mod.rs`).
 */

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    public readonly message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

/**
 * Extract a human-readable message from an unknown error value. Server
 * error bodies, thrown `Error`s, and plain strings are all handled.
 */
export function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message || fallback
  }
  if (typeof error === "string" && error.length > 0) {
    return error
  }
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>
    const message = obj.message || obj.error || obj.msg
    if (typeof message === "string" && message.length > 0) {
      return message
    }
  }
  return fallback
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined
  const text = await res.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * POST `body` as JSON to `path` (relative to the server's own origin) with
 * the session cookie attached, and resolve with the parsed response body.
 * Throws `ApiError` on any non-2xx response.
 */
export async function httpRequest<T>(path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new ApiError(error instanceof Error ? error.message : "Network request failed")
  }

  const parsed = await parseBody(response)

  if (!response.ok) {
    const message = extractErrorMessage(parsed, `Request failed (${response.status})`)
    const code =
      typeof parsed === "object" && parsed !== null && "kind" in parsed
        ? String((parsed as Record<string, unknown>).kind)
        : undefined
    throw new ApiError(message, code, parsed)
  }

  return parsed as T
}
