import type { QQCredentials, QQMessageResponse } from "./types.js";

const DEFAULT_API_BASE = "https://api.sgroup.qq.com";
const DEFAULT_TOKEN_BASE = "https://bots.qq.com";
const TOKEN_REFRESH_AHEAD_MS = 5 * 60_000;
const QQ_API_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_MS = 2_147_483_647;

export const parseRetryAfterMs = (value: string | null, now = Date.now()): number | undefined => {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.min(MAX_RETRY_AFTER_MS, Math.max(0, at - now)) : undefined;
};

export class QQApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
    public readonly bizCode?: number,
    public readonly bizMessage?: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "QQApiError";
  }
}

export enum QQMediaFileType {
  IMAGE = 1,
  VIDEO = 2,
  VOICE = 3,
  FILE = 4,
}

type TokenCacheEntry = {
  token: string;
  expiresAt: number;
};

type QQUploadMediaResponse = {
  file_uuid: string;
  file_info: string;
  ttl: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();
const tokenPromises = new Map<string, Promise<string>>();
const MESSAGE_SEQ_TTL_MS = 60 * 60_000;
const MESSAGE_SEQ_MAX_ENTRIES = 10_000;
const messageSeq = new Map<string, { seq: number; expiresAt: number }>();

const normalizeBase = (value: string | undefined, fallback: string) => (value?.trim() || fallback).replace(/\/+$/, "");

export const getNextQQMessageSeq = (messageId: string) => {
  const now = Date.now();
  const current = messageSeq.get(messageId);
  const next = current && current.expiresAt > now ? current.seq + 1 : 1;
  messageSeq.set(messageId, { seq: next, expiresAt: now + MESSAGE_SEQ_TTL_MS });
  if (messageSeq.size > MESSAGE_SEQ_MAX_ENTRIES) {
    for (const [key, value] of messageSeq) {
      if (value.expiresAt <= now) messageSeq.delete(key);
    }
  }
  return next;
};

export class QQApiClient {
  private readonly apiBase: string;
  private readonly tokenUrl: string;

  constructor(private readonly credentials: QQCredentials) {
    this.apiBase = normalizeBase(credentials.baseUrl, process.env.QQBOT_BASE_URL || DEFAULT_API_BASE);
    this.tokenUrl = `${normalizeBase(credentials.tokenBaseUrl, process.env.QQBOT_TOKEN_BASE_URL || DEFAULT_TOKEN_BASE)}/app/getAppAccessToken`;
  }

  async getAccessToken(forceRefresh = false) {
    const appId = this.credentials.appId.trim();
    const secret = this.credentials.clientSecret.trim();
    if (!appId || !secret) throw new Error("QQ appId and clientSecret are required");

    const cached = tokenCache.get(appId);
    if (!forceRefresh && cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_AHEAD_MS) return cached.token;

    const existing = tokenPromises.get(appId);
    if (existing && !forceRefresh) return existing;

    const promise = this.fetchAccessToken(appId, secret).finally(() => tokenPromises.delete(appId));
    tokenPromises.set(appId, promise);
    return promise;
  }

  async getGatewayUrl() {
    const data = await this.request<{ url: string }>("GET", "/gateway");
    if (!data.url) throw new Error("QQ gateway URL is missing");
    return data.url;
  }

  async sendC2CMessage(openid: string, content: string, msgId?: string, markdownSupport = false) {
    return this.sendMessage(`/v2/users/${encodeURIComponent(openid)}/messages`, content, msgId, markdownSupport);
  }

  async sendGroupMessage(groupOpenid: string, content: string, msgId?: string, markdownSupport = false) {
    return this.sendMessage(`/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, content, msgId, markdownSupport);
  }

  async sendChannelMessage(channelId: string, content: string, msgId?: string) {
    return this.request<QQMessageResponse>("POST", `/channels/${encodeURIComponent(channelId)}/messages`, {
      content,
      ...(msgId ? { msg_id: msgId } : {}),
    });
  }

  async sendC2CImageMessage(openid: string, imageUrl: string, msgId?: string, content?: string) {
    return this.sendC2CMedia(openid, QQMediaFileType.IMAGE, imageUrl, msgId, content);
  }

  async sendGroupImageMessage(groupOpenid: string, imageUrl: string, msgId?: string, content?: string) {
    return this.sendGroupMedia(groupOpenid, QQMediaFileType.IMAGE, imageUrl, msgId, content);
  }

  async sendC2CMedia(openid: string, fileType: QQMediaFileType, source: string, msgId?: string, content?: string, fileName?: string) {
    const upload = await this.uploadC2CMedia(openid, fileType, source, fileName);
    return this.sendC2CMediaMessage(openid, upload.file_info, msgId, content);
  }

  async sendGroupMedia(groupOpenid: string, fileType: QQMediaFileType, source: string, msgId?: string, content?: string, fileName?: string) {
    const upload = await this.uploadGroupMedia(groupOpenid, fileType, source, fileName);
    return this.sendGroupMediaMessage(groupOpenid, upload.file_info, msgId, content);
  }

  async sendC2CStreamMessage(openid: string, req: {
    inputState: "generating" | "done";
    contentRaw: string;
    eventId: string;
    msgId: string;
    msgSeq: number;
    index: number;
    streamMsgId?: string;
  }) {
    return this.request<QQMessageResponse>("POST", `/v2/users/${encodeURIComponent(openid)}/stream_messages`, {
      input_mode: "replace",
      input_state: req.inputState === "done" ? 10 : 1,
      content_type: "markdown",
      content_raw: req.contentRaw,
      event_id: req.eventId,
      msg_id: req.msgId,
      msg_seq: req.msgSeq,
      index: req.index,
      ...(req.streamMsgId ? { stream_msg_id: req.streamMsgId } : {}),
    });
  }

  async uploadC2CMedia(openid: string, fileType: QQMediaFileType, source: string, fileName?: string) {
    return this.uploadMedia(`/v2/users/${encodeURIComponent(openid)}/files`, fileType, source, fileName);
  }

  async uploadGroupMedia(groupOpenid: string, fileType: QQMediaFileType, source: string, fileName?: string) {
    return this.uploadMedia(`/v2/groups/${encodeURIComponent(groupOpenid)}/files`, fileType, source, fileName);
  }

  async sendC2CMediaMessage(openid: string, fileInfo: string, msgId?: string, content?: string) {
    return this.sendMediaMessage(`/v2/users/${encodeURIComponent(openid)}/messages`, fileInfo, msgId, content);
  }

  async sendGroupMediaMessage(groupOpenid: string, fileInfo: string, msgId?: string, content?: string) {
    return this.sendMediaMessage(`/v2/groups/${encodeURIComponent(groupOpenid)}/messages`, fileInfo, msgId, content);
  }

  async request<T>(method: string, path: string, body?: unknown, forceRefresh = false): Promise<T> {
    const token = await this.getAccessToken(forceRefresh);
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "CohubGateway/1.0 QQBotProvider",
      },
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(QQ_API_TIMEOUT_MS),
    });

    const text = await response.text();
    const data = text ? safeJson(text) : null;
    if (!response.ok) {
      const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
      const bizCode = typeof payload.code === "number" ? payload.code : typeof payload.err_code === "number" ? payload.err_code : undefined;
      const bizMessage = typeof payload.message === "string" ? payload.message : typeof payload.err_msg === "string" ? payload.err_msg : undefined;
      if (!forceRefresh && (response.status === 401 || response.status === 403)) {
        tokenCache.delete(this.credentials.appId.trim());
        return this.request<T>(method, path, body, true);
      }
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      throw new QQApiError(
        `QQ API ${method} ${path} failed: ${response.status} ${bizMessage ?? text}`,
        response.status,
        path,
        bizCode,
        bizMessage,
        retryAfterMs,
      );
    }
    return data as T;
  }

  private async sendMessage(path: string, content: string, msgId: string | undefined, markdownSupport: boolean) {
    const body = markdownSupport
      ? { markdown: { content }, msg_type: 2, msg_seq: msgId ? getNextQQMessageSeq(msgId) : 1, ...(msgId ? { msg_id: msgId } : {}) }
      : { content, msg_type: 0, msg_seq: msgId ? getNextQQMessageSeq(msgId) : 1, ...(msgId ? { msg_id: msgId } : {}) };
    return this.request<QQMessageResponse>("POST", path, body);
  }

  private async sendMediaMessage(path: string, fileInfo: string, msgId: string | undefined, content: string | undefined) {
    return this.request<QQMessageResponse>("POST", path, {
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_seq: msgId ? getNextQQMessageSeq(msgId) : 1,
      ...(content?.trim() ? { content: content.trim() } : {}),
      ...(msgId ? { msg_id: msgId } : {}),
    });
  }

  private async uploadMedia(path: string, fileType: QQMediaFileType, source: string, fileName?: string) {
    const body: Record<string, unknown> = { file_type: fileType, srv_send_msg: false };
    const dataUrl = source.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrl?.[2]) body.file_data = dataUrl[2];
    else body.url = source;
    if (fileName && fileType === QQMediaFileType.FILE) body.file_name = fileName;
    return this.request<QQUploadMediaResponse>("POST", path, body);
  }

  private async fetchAccessToken(appId: string, clientSecret: string) {
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "CohubGateway/1.0 QQBotProvider",
      },
      body: JSON.stringify({ appId, clientSecret }),
      signal: AbortSignal.timeout(QQ_API_TIMEOUT_MS),
    });
    const text = await response.text();
    const data = text ? safeJson(text) as Record<string, unknown> : {};
    if (!response.ok) {
      throw new QQApiError(
        `QQ token request failed: ${response.status} ${text}`,
        response.status,
        "/app/getAppAccessToken",
        undefined,
        undefined,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    }
    const token = typeof data.access_token === "string" ? data.access_token : typeof data.accessToken === "string" ? data.accessToken : "";
    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : typeof data.expiresIn === "number" ? data.expiresIn : 7200;
    if (!token) throw new Error("QQ token response missing access_token");
    tokenCache.set(appId, { token, expiresAt: Date.now() + Math.max(60, expiresIn) * 1000 });
    return token;
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
