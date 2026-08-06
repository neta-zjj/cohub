import { SPACE_CONFIG_PATH } from "@cohub/protocol";
import { HttpError } from "@neta-art/cohub";
import { sdk } from "$lib/sdk";
import {
	type NewChatBackgroundConfig,
	type NewChatComposerApplyPayload,
	parseSpaceConfig,
	type SpaceConfig,
	type WorkspaceDefaultLayout,
	type WorkspaceLayoutPresentation,
} from "$lib/space-config-parse";
import { spacePreviewSessionCache } from "$lib/space-preview-session-cache";

export type {
	NewChatBackgroundConfig,
	NewChatComposerApplyPayload,
	SpaceConfig,
	WorkspaceDefaultLayout,
	WorkspaceLayoutPresentation,
};
export { parseSpaceConfig };

type SpaceConfigListener = (config: SpaceConfig | null) => void;
export type NewChatBackgroundActionListener = (
	action: NewChatComposerApplyPayload,
) => void;

const MAX_RETRY_ATTEMPTS = 5;
const RETRYABLE_ERROR_DELAY_MS = 1200;
const listeners = new Set<SpaceConfigListener>();
const backgroundActionListeners = new Set<NewChatBackgroundActionListener>();

let activeSpaceId: string | null = null;
let activeVersion = 0;
let activeConfig: SpaceConfig | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function getCacheKey(spaceId: string) {
	return `cohub:space-config:${spaceId}:v1`;
}

function readCachedConfig(spaceId: string) {
	if (typeof localStorage === "undefined") return null;
	try {
		const raw = localStorage.getItem(getCacheKey(spaceId));
		return raw ? parseSpaceConfig(raw) : null;
	} catch {
		return null;
	}
}

function writeCachedConfig(spaceId: string, raw: string) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(getCacheKey(spaceId), raw);
	} catch {
		// Cache writes are best-effort and should never block workspace boot.
	}
}

function clearCachedConfig(spaceId: string) {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.removeItem(getCacheKey(spaceId));
	} catch {
		// ignore
	}
}

function clearRetryTimer() {
	if (!retryTimer) return;
	clearTimeout(retryTimer);
	retryTimer = null;
}

function publish(config: SpaceConfig | null) {
	activeConfig = config;
	for (const listener of listeners) listener(config);
}

function scheduleRetry(
	spaceId: string,
	version: number,
	attempt: number,
	delayMs: number,
) {
	if (attempt >= MAX_RETRY_ATTEMPTS) return;
	clearRetryTimer();
	retryTimer = setTimeout(
		() => {
			retryTimer = null;
			if (activeVersion !== version || activeSpaceId !== spaceId) return;
			void loadSpaceConfig(spaceId, { version, attempt: attempt + 1 });
		},
		Math.max(250, delayMs),
	);
}

async function loadSpaceConfig(
	spaceId: string,
	options: { version: number; attempt?: number },
) {
	const attempt = options.attempt ?? 0;
	try {
		const request = sdk.space(spaceId).getStartup();
		spacePreviewSessionCache.prime(
			spaceId,
			request.then((startup) => startup.previewSession),
		);
		const startup = await request;
		if (activeVersion !== options.version || activeSpaceId !== spaceId) return;
		if (startup.status === "preparing") {
			scheduleRetry(
				spaceId,
				options.version,
				attempt,
				startup.retryAfterMs ?? RETRYABLE_ERROR_DELAY_MS,
			);
			return;
		}
		if (startup.status === "missing") clearCachedConfig(spaceId);
		else if (startup.configRaw !== null)
			writeCachedConfig(spaceId, startup.configRaw);
		publish(startup.config);
	} catch (error) {
		if (activeVersion !== options.version || activeSpaceId !== spaceId) return;
		const isRetryableHttpError =
			error instanceof HttpError &&
			(error.status === 408 || error.status === 429 || error.status >= 500);
		if (!(error instanceof HttpError) || isRetryableHttpError) {
			scheduleRetry(
				spaceId,
				options.version,
				attempt,
				RETRYABLE_ERROR_DELAY_MS * 2 ** attempt,
			);
		}
	}
}

export function activateSpaceConfig(spaceId: string) {
	clearRetryTimer();
	activeSpaceId = spaceId;
	activeVersion += 1;
	void loadSpaceConfig(spaceId, { version: activeVersion });
	publish(readCachedConfig(spaceId));
}

export function refreshSpaceConfig(spaceId: string) {
	if (activeSpaceId !== spaceId) return;
	clearRetryTimer();
	activeVersion += 1;
	void loadSpaceConfig(spaceId, { version: activeVersion });
}

export function deactivateSpaceConfig(spaceId?: string) {
	if (spaceId && activeSpaceId !== spaceId) return;
	clearRetryTimer();
	activeSpaceId = null;
	activeVersion += 1;
	publish(null);
}

export function subscribeSpaceConfig(listener: SpaceConfigListener) {
	listeners.add(listener);
	listener(activeConfig);
	return () => listeners.delete(listener);
}

export function emitSpaceConfigBackgroundAction(
	action: NewChatComposerApplyPayload,
) {
	for (const listener of backgroundActionListeners) listener(action);
}

export function subscribeSpaceConfigBackgroundAction(
	listener: NewChatBackgroundActionListener,
) {
	backgroundActionListeners.add(listener);
	return () => backgroundActionListeners.delete(listener);
}

export function isSpaceConfigPath(path: string | null | undefined) {
	return path?.replace(/\\/g, "/").replace(/^\.\/+/, "") === SPACE_CONFIG_PATH;
}
