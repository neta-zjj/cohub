export type FileAutosaveOutcome = "saved" | "clean" | "blocked";

type Runtime = {
	debounceTimer: ReturnType<typeof setTimeout> | null;
	maxTimer: ReturnType<typeof setTimeout> | null;
	inFlight: Promise<FileAutosaveOutcome> | null;
	queued: boolean;
};

type FileAutosaveCoordinatorOptions = {
	save: (path: string) => Promise<FileAutosaveOutcome>;
	debounceMs?: number;
	maxWaitMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 1_500;
const DEFAULT_MAX_WAIT_MS = 10_000;

export function createFileAutosaveCoordinator(
	options: FileAutosaveCoordinatorOptions,
) {
	const runtimes = new Map<string, Runtime>();
	const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
	let disposed = false;

	function getRuntime(path: string) {
		let runtime = runtimes.get(path);
		if (!runtime) {
			runtime = {
				debounceTimer: null,
				maxTimer: null,
				inFlight: null,
				queued: false,
			};
			runtimes.set(path, runtime);
		}
		return runtime;
	}

	function clearTimers(runtime: Runtime) {
		if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
		if (runtime.maxTimer) clearTimeout(runtime.maxTimer);
		runtime.debounceTimer = null;
		runtime.maxTimer = null;
	}

	async function flush(path: string): Promise<FileAutosaveOutcome> {
		if (disposed) return "blocked";
		const runtime = getRuntime(path);
		clearTimers(runtime);
		if (runtime.inFlight) {
			runtime.queued = true;
			return runtime.inFlight;
		}

		const run = (async () => {
			let outcome: FileAutosaveOutcome = "clean";
			do {
				runtime.queued = false;
				outcome = await options.save(path);
			} while (!disposed && outcome === "saved" && runtime.queued);
			return outcome;
		})();
		runtime.inFlight = run;
		try {
			return await run;
		} finally {
			runtime.inFlight = null;
			if (
				runtimes.get(path) === runtime &&
				!runtime.queued &&
				!runtime.debounceTimer &&
				!runtime.maxTimer
			) {
				runtimes.delete(path);
			}
		}
	}

	function schedule(path: string) {
		if (disposed) return;
		const runtime = getRuntime(path);
		if (runtime.inFlight) {
			runtime.queued = true;
			return;
		}
		if (runtime.debounceTimer) clearTimeout(runtime.debounceTimer);
		runtime.debounceTimer = setTimeout(() => {
			runtime.debounceTimer = null;
			void flush(path);
		}, debounceMs);
		if (!runtime.maxTimer) {
			runtime.maxTimer = setTimeout(() => {
				runtime.maxTimer = null;
				void flush(path);
			}, maxWaitMs);
		}
	}

	function retry(path: string, delayMs: number) {
		if (disposed) return;
		const runtime = getRuntime(path);
		clearTimers(runtime);
		runtime.debounceTimer = setTimeout(() => {
			runtime.debounceTimer = null;
			void flush(path);
		}, delayMs);
	}

	function cancel(path: string) {
		const runtime = runtimes.get(path);
		if (!runtime) return;
		clearTimers(runtime);
		runtime.queued = false;
		runtimes.delete(path);
	}

	function dispose() {
		disposed = true;
		for (const runtime of runtimes.values()) clearTimers(runtime);
		runtimes.clear();
	}

	return { schedule, retry, flush, cancel, dispose };
}
