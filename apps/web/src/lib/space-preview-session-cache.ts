import type { SpacePreviewSessionCredential } from "@cohub/protocol";

const REFRESH_SKEW_MS = 60_000;

export type CachedSpacePreviewSession = {
	token: string;
	expiresAt: number;
};

export function createSpacePreviewSessionCache(now = () => Date.now()) {
	const sessions = new Map<string, CachedSpacePreviewSession>();
	const loads = new Map<string, Promise<CachedSpacePreviewSession>>();
	const primes = new Map<string, Promise<CachedSpacePreviewSession | null>>();

	function read(spaceId: string) {
		const cached = sessions.get(spaceId);
		if (!cached) return null;
		if (cached.expiresAt - now() <= REFRESH_SKEW_MS) {
			sessions.delete(spaceId);
			return null;
		}
		return cached;
	}

	function remember(
		spaceId: string,
		credential: SpacePreviewSessionCredential,
	) {
		const token = credential.token.trim();
		if (!token || !Number.isFinite(credential.expiresIn)) return null;
		const session = {
			token,
			expiresAt: now() + Math.max(0, credential.expiresIn) * 1_000,
		};
		sessions.set(spaceId, session);
		return session;
	}

	function prime(
		spaceId: string,
		request: Promise<SpacePreviewSessionCredential | null>,
	) {
		const current = request
			.then((credential) => (credential ? remember(spaceId, credential) : null))
			.catch(() => null)
			.finally(() => {
				if (primes.get(spaceId) === current) primes.delete(spaceId);
			});
		primes.set(spaceId, current);
		return current;
	}

	async function get(
		spaceId: string,
		load: () => Promise<SpacePreviewSessionCredential>,
	) {
		const cached = read(spaceId);
		if (cached) return cached;

		const primed = primes.get(spaceId);
		if (primed) {
			const session = await primed;
			if (session) return session;
			const afterPrime = read(spaceId);
			if (afterPrime) return afterPrime;
		}

		const existing = loads.get(spaceId);
		if (existing) return existing;
		const request = load()
			.then((credential) => {
				const session = remember(spaceId, credential);
				if (!session) throw new Error("Invalid preview session response.");
				return session;
			})
			.finally(() => {
				if (loads.get(spaceId) === request) loads.delete(spaceId);
			});
		loads.set(spaceId, request);
		return request;
	}

	function clear(spaceId?: string) {
		if (spaceId) {
			sessions.delete(spaceId);
			loads.delete(spaceId);
			primes.delete(spaceId);
			return;
		}
		sessions.clear();
		loads.clear();
		primes.clear();
	}

	return { read, remember, prime, get, clear };
}

export const spacePreviewSessionCache = createSpacePreviewSessionCache();
