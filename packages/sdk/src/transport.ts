import type { RequestSource } from "@cohub/protocol/provenance";
import { requestSourceToHeaders } from "@cohub/protocol/provenance";
import type { CohubEnvironment } from "./environment.js";
import { resolveApiBaseUrl } from "./environment.js";
import type { WebsocketClientOptions } from "./websocket.js";
import type { VoiceInputCreateOptions } from "./voice-input.js";
import type { WorkRuntimeModeConfig } from "./work-runtime.js";

export type Fetch = typeof globalThis.fetch;

type RequestInitWithFetch = RequestInit & {
  fetch?: Fetch;
  /** When true, 401 responses throw without invoking onUnauthorized (e.g. session bootstrap). */
  skipUnauthorizedHandler?: boolean;
};

const responseBodyForError = async (response: Response) => {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => response.statusText);
};

const messageFromErrorBody = (body: unknown, fallback: string) => {
  if (typeof body === "string") return body.trim() || fallback;
  if (body && typeof body === "object") {
    const errorBody = body as { message?: unknown };
    if (typeof errorBody.message === "string" && errorBody.message.trim()) return errorBody.message;
  }
  return fallback;
};

export type RawHttpResponse = {
  response: Response;
  blob(): Promise<Blob>;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

export type CohubClientOptions = {
  env?: CohubEnvironment;
  baseUrl?: string;
  getAccessToken?: (options?: { forceRefresh?: boolean }) => Promise<string | null> | string | null;
  onUnauthorized?: () => Promise<void> | void;
  setStoredAuthToken?: (token: string) => void;
  clearStoredAuthToken?: () => void;
  fetch?: Fetch;
  websocket?: WebsocketClientOptions;
  voice?: VoiceInputCreateOptions;
  /** Work runtime mode configuration (bridge vs broker). */
  work?: WorkRuntimeModeConfig;
  /** Optional X-Cohub-Source-* headers (static or per-request getter). */
  requestSource?: RequestSource | null | (() => RequestSource | null | undefined);
};

function errorCodeFromBody(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const errorBody = body as { code?: unknown };
  if (typeof errorBody.code === "string" && errorBody.code.trim()) return errorBody.code;
  return null;
}

/**
 * Access tokens must be a single HTTP header token.
 * Newlines / control chars (from corrupted storage or clipboard paste) make
 * `Headers#set` throw TypeError — Safari: "The string did not match the expected pattern."
 */
export function sanitizeAccessToken(token: string | null | undefined): string | null {
  if (typeof token !== "string") return null;
  // Strip CR/LF/TAB/NUL and surrounding whitespace; keep the rest of the JWT/opaque token.
  const cleaned = token.replace(/[\r\n\t\0]/g, "").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Join API base + path without double slashes; prefer URL when base is absolute. */
export function joinApiUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!base) return normalizedPath;
  if (/^https?:\/\//i.test(base)) {
    try {
      return new URL(normalizedPath, `${base}/`).href;
    } catch {
      // Fall through to string join for non-standard bases.
    }
  }
  return `${base}${normalizedPath}`;
}

function isBrowserRequestConstructionError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = error.message || "";
  return (
    message === "The string did not match the expected pattern." ||
    /invalid header value|Failed to construct|is an invalid header/i.test(message)
  );
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code: string | null;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
    this.code = errorCodeFromBody(body);
  }
}

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly fetcher: Fetch;
  private readonly getAccessToken?: (options?: { forceRefresh?: boolean }) => Promise<string | null> | string | null;
  private readonly onUnauthorized?: () => Promise<void> | void;
  private readonly requestSource?: RequestSource | null | (() => RequestSource | null | undefined);

  constructor(options: CohubClientOptions = {}) {
    this.baseUrl = resolveApiBaseUrl(options);
    this.fetcher = options.fetch ?? fetch;
    this.getAccessToken = options.getAccessToken;
    this.onUnauthorized = options.onUnauthorized;
    this.requestSource = options.requestSource;
  }

  private resolveRequestSource(): RequestSource | null {
    if (!this.requestSource) return null;
    if (typeof this.requestSource === "function") {
      return this.requestSource() ?? null;
    }
    return this.requestSource;
  }

  private applyRequestSourceHeaders(headers: Headers): void {
    const sourceHeaders = requestSourceToHeaders(this.resolveRequestSource());
    for (const [name, value] of Object.entries(sourceHeaders)) {
      // Explicit per-request headers win over the client-level defaults.
      if (!headers.has(name)) headers.set(name, value);
    }
  }

  private async withAuthorization(
    init?: RequestInitWithFetch,
    tokenOverride?: string | null,
  ): Promise<RequestInit> {
    const { fetch: _fetch, skipUnauthorizedHandler: _skip, ...requestInit } = init ?? {};
    const headers = new Headers(requestInit.headers);
    const rawToken =
      tokenOverride !== undefined
        ? tokenOverride
        : this.getAccessToken
          ? await this.getAccessToken()
          : null;
    const token = sanitizeAccessToken(rawToken);

    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.delete("Authorization");
    }

    this.applyRequestSourceHeaders(headers);

    return {
      ...requestInit,
      headers,
    };
  }

  private async send(path: string, init?: RequestInitWithFetch) {
    const fetcher = init?.fetch ?? this.fetcher;
    const url = joinApiUrl(this.baseUrl, path);
    const skipUnauthorizedHandler = Boolean(init?.skipUnauthorizedHandler);

    let response: Response;
    try {
      response = await fetcher(url, await this.withAuthorization(init));
    } catch (error) {
      if (isBrowserRequestConstructionError(error)) {
        throw new Error(
          "Could not send request. Your session may be invalid — try refreshing or signing in again.",
          { cause: error },
        );
      }
      throw error;
    }

    const getAccessToken = this.getAccessToken;
    if (response.status === 401 && getAccessToken) {
      const refreshedToken = await (async () => {
        try {
          return sanitizeAccessToken(await getAccessToken({ forceRefresh: true }));
        } catch {
          return null;
        }
      })();
      if (refreshedToken) {
        let retryResponse: Response;
        try {
          retryResponse = await fetcher(url, await this.withAuthorization(init, refreshedToken));
        } catch (error) {
          if (isBrowserRequestConstructionError(error)) {
            throw new Error(
              "Could not send request. Your session may be invalid — try refreshing or signing in again.",
              { cause: error },
            );
          }
          throw error;
        }
        if (retryResponse.status !== 401) {
          if (!retryResponse.ok) {
            const body = await responseBodyForError(retryResponse);
            throw new HttpError(
              messageFromErrorBody(body, retryResponse.statusText),
              retryResponse.status,
              body,
            );
          }
          return retryResponse;
        }
      }
    }

    if (response.status === 401) {
      if (!skipUnauthorizedHandler) {
        await this.onUnauthorized?.();
      }
      throw new HttpError("unauthorized", 401, null);
    }

    if (!response.ok) {
      const body = await responseBodyForError(response);
      throw new HttpError(
        messageFromErrorBody(body, response.statusText),
        response.status,
        body,
      );
    }

    return response;
  }

  async request<T>(path: string, init?: RequestInitWithFetch) {
    const response = await this.send(path, init);

    if (response.status === 204) {
      return null as T;
    }

    return response.json() as Promise<T>;
  }

  async raw(path: string, init?: RequestInitWithFetch): Promise<RawHttpResponse> {
    const response = await this.send(path, init);
    return {
      response,
      blob: () => response.blob(),
      arrayBuffer: () => response.arrayBuffer(),
      text: () => response.text(),
      json: () => response.json(),
    };
  }

  async blob(path: string, init?: RequestInitWithFetch) {
    const raw = await this.raw(path, init);
    return raw.blob();
  }
}
