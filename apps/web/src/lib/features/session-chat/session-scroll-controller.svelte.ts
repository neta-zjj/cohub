import { measureTurnRailMarkers } from "./turn-rail-markers";

export type ChatTimelineHandle = {
	preparePrepend: () => void;
	finalizePrepend: () => void;
};

export type SessionScrollAnchor = {
	sequence: number;
	offset: number;
	updatedAt: number;
};

export function resolveSessionScrollRestore(input: {
	anchorTop: number;
	anchorOffset: number;
	scrollHeight: number;
	clientHeight: number;
}) {
	const desiredScrollTop = Math.max(0, input.anchorTop + input.anchorOffset);
	const maxScrollTop = Math.max(0, input.scrollHeight - input.clientHeight);
	return {
		scrollTop: Math.min(desiredScrollTop, maxScrollTop),
		reached: desiredScrollTop <= maxScrollTop + 1,
	};
}

const AUTO_FOLLOW_THRESHOLD_PX = 60;

/**
 * Timeline `data-sequence` values:
 * - process cards: turn.sequence (1, 2, 3…)
 * - user messages: turn.sequence * 10
 * - assistant messages: turn.sequence * 10 + 2
 * - streaming previews: ephemeral higher bands
 */
export function isSessionScrollAnchorInTurns(
	anchorSequence: number,
	turns: Array<{ sequence: number }>,
) {
	if (!Number.isFinite(anchorSequence)) return false;
	return turns.some((turn) => {
		if (turn.sequence === anchorSequence) return true;
		// Message-style sequences live in the turn*10 band (user / assistant / extras).
		return Math.floor(anchorSequence / 10) === turn.sequence;
	});
}

function areNumberRecordsEqual(
	current: Record<number, number>,
	next: Record<number, number>,
) {
	if (current === next) return true;
	const currentKeys = Object.keys(current);
	const nextKeys = Object.keys(next);
	if (currentKeys.length !== nextKeys.length) return false;
	for (const key of currentKeys) {
		const numKey = Number(key);
		if (current[numKey] !== next[numKey]) return false;
	}
	return true;
}

export function createSessionScrollController() {
	let listEl = $state<HTMLDivElement | null>(null);
	let chatTimelineRef = $state<ChatTimelineHandle | null>(null);
	let composerHeight = $state(0);
	let chatChromeHeight = $state(0);
	let shouldAutoFollow = $state(true);
	let turnMarkerPositions = $state<Record<number, number>>({});
	let turnMarkerHeights = $state<Record<number, number>>({});
	let timelineScrollTop = $state(0);
	let timelineScrollHeight = $state(0);
	let timelineClientHeight = $state(0);
	let scrollAnchorBySession = $state.raw(
		new Map<string, SessionScrollAnchor>(),
	);
	let pendingRestoreSessionId = $state<string | null>(null);
	let activeAnchorRestore = $state<
		(SessionScrollAnchor & { sessionId: string }) | null
	>(null);
	let pendingTimelineMarkdownRenders = $state(0);
	let anchorRestoreWaitingForLayout = $state(false);
	let vimScrollFrame: number | null = null;
	let vimScrollVelocity = 0;
	let vimScrollStopTimer: ReturnType<typeof setTimeout> | null = null;
	let vimPendingGTimer: ReturnType<typeof setTimeout> | null = null;

	function loadSessionScrollAnchors(storageKey: string) {
		try {
			const raw = localStorage.getItem(storageKey);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Record<string, SessionScrollAnchor>;
			scrollAnchorBySession = new Map(
				Object.entries(parsed).filter(([, anchor]) =>
					Boolean(
						anchor &&
							typeof anchor.sequence === "number" &&
							typeof anchor.offset === "number",
					),
				),
			);
		} catch {
			// ignore corrupt local scroll cache
		}
	}

	function persistSessionScrollAnchorsNow(storageKey: string) {
		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify(Object.fromEntries(scrollAnchorBySession.entries())),
			);
		} catch {
			// ignore storage failures
		}
	}

	function setSessionScrollAnchor(
		storageKey: string,
		sessionId: string,
		anchor: SessionScrollAnchor,
	) {
		// Reassign so `$state.raw` consumers observe the write.
		const next = new Map(scrollAnchorBySession);
		next.set(sessionId, anchor);
		scrollAnchorBySession = next;
		persistSessionScrollAnchorsNow(storageKey);
	}

	function getSessionScrollAnchor(sessionId: string) {
		return scrollAnchorBySession.get(sessionId);
	}

	function clearSessionScrollAnchor(storageKey: string, sessionId: string) {
		if (!scrollAnchorBySession.has(sessionId)) return;
		const next = new Map(scrollAnchorBySession);
		next.delete(sessionId);
		scrollAnchorBySession = next;
		persistSessionScrollAnchorsNow(storageKey);
	}

	function getMessageElementAbsoluteTop(node: HTMLElement) {
		if (!listEl) return 0;
		const containerRect = listEl.getBoundingClientRect();
		const nodeRect = node.getBoundingClientRect();
		return listEl.scrollTop + (nodeRect.top - containerRect.top);
	}

	function updateTimelineScrollMetrics() {
		if (!listEl) {
			if (timelineScrollTop !== 0) timelineScrollTop = 0;
			if (timelineScrollHeight !== 0) timelineScrollHeight = 0;
			if (timelineClientHeight !== 0) timelineClientHeight = 0;
			return;
		}
		const nextTop = listEl.scrollTop;
		const nextHeight = listEl.scrollHeight;
		const nextClient = listEl.clientHeight;
		if (timelineScrollTop !== nextTop) timelineScrollTop = nextTop;
		if (timelineScrollHeight !== nextHeight) timelineScrollHeight = nextHeight;
		if (timelineClientHeight !== nextClient) timelineClientHeight = nextClient;
	}

	function getTimelineBottomScrollTop() {
		if (!listEl) return 0;
		return Math.max(0, listEl.scrollHeight - listEl.clientHeight);
	}

	function updateAutoFollow(threshold = AUTO_FOLLOW_THRESHOLD_PX) {
		if (!listEl) return;
		const distanceFromBottom =
			listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
		const next = distanceFromBottom <= threshold;
		if (shouldAutoFollow !== next) shouldAutoFollow = next;
	}

	function shouldPinToBottom(options?: { immediate?: boolean }) {
		return Boolean(listEl && (options?.immediate || shouldAutoFollow));
	}

	function clearTurnMarkers() {
		if (Object.keys(turnMarkerPositions).length > 0) turnMarkerPositions = {};
		if (Object.keys(turnMarkerHeights).length > 0) turnMarkerHeights = {};
	}

	function measureTurnMarkerPositions(_turnScrollAnchorOffset?: number) {
		if (!listEl) {
			clearTurnMarkers();
			updateTimelineScrollMetrics();
			return;
		}
		updateTimelineScrollMetrics();
		const scrollContainer = listEl;
		const anchors = Array.from(
			scrollContainer.querySelectorAll<HTMLElement>(
				'[data-turn-anchor="user"]',
			),
		).map((anchor) => ({
			sequence: Number(anchor.dataset.turnSequence),
			absoluteTop: getMessageElementAbsoluteTop(anchor),
			offsetHeight: anchor.offsetHeight,
		}));
		// Jump comfort offset is only for scroll-into-view, not minimap placement.
		const { positions, heights } = measureTurnRailMarkers({
			scrollHeight: scrollContainer.scrollHeight,
			clientHeight: scrollContainer.clientHeight,
			anchors,
		});
		if (!areNumberRecordsEqual(turnMarkerPositions, positions)) {
			turnMarkerPositions = positions;
		}
		if (!areNumberRecordsEqual(turnMarkerHeights, heights)) {
			turnMarkerHeights = heights;
		}
	}

	function stopVimScroll() {
		vimScrollVelocity = 0;
		if (vimScrollStopTimer) {
			clearTimeout(vimScrollStopTimer);
			vimScrollStopTimer = null;
		}
		if (vimScrollFrame != null) {
			cancelAnimationFrame(vimScrollFrame);
			vimScrollFrame = null;
		}
	}

	function runVimScrollFrame() {
		if (!listEl || vimScrollVelocity === 0) {
			stopVimScroll();
			return;
		}
		listEl.scrollTop = Math.min(
			Math.max(0, listEl.scrollHeight - listEl.clientHeight),
			Math.max(0, listEl.scrollTop + vimScrollVelocity),
		);
		vimScrollFrame = requestAnimationFrame(runVimScrollFrame);
	}

	function scrollTimelineByLines(
		direction: 1 | -1,
		beginUserScroll: () => void,
	) {
		if (!listEl) return;
		beginUserScroll();
		vimScrollVelocity = direction * 10;
		if (vimScrollFrame == null) {
			vimScrollFrame = requestAnimationFrame(runVimScrollFrame);
		}
		if (vimScrollStopTimer) clearTimeout(vimScrollStopTimer);
		vimScrollStopTimer = setTimeout(stopVimScroll, 110);
	}

	function clearPendingVimG() {
		if (!vimPendingGTimer) return;
		clearTimeout(vimPendingGTimer);
		vimPendingGTimer = null;
	}

	function armPendingVimG(timeoutMs = 550) {
		vimPendingGTimer = setTimeout(() => {
			vimPendingGTimer = null;
		}, timeoutMs);
	}

	function scrollTimelineToTop(
		beginUserScroll: () => void,
		setProgrammaticScrollTop: (scrollTop: number) => void,
		onScrolled?: () => void,
	) {
		if (!listEl) return;
		beginUserScroll();
		shouldAutoFollow = false;
		setProgrammaticScrollTop(0);
		requestAnimationFrame(() => onScrolled?.());
	}

	function scrollTimelineToBottom(scrollToBottomNow: () => void) {
		if (!listEl) return;
		shouldAutoFollow = true;
		stopVimScroll();
		scrollToBottomNow();
	}

	function resetSessionScrollUi() {
		clearTurnMarkers();
		if (timelineScrollTop !== 0) timelineScrollTop = 0;
		if (timelineScrollHeight !== 0) timelineScrollHeight = 0;
		if (timelineClientHeight !== 0) timelineClientHeight = 0;
		pendingRestoreSessionId = null;
		activeAnchorRestore = null;
		pendingTimelineMarkdownRenders = 0;
		anchorRestoreWaitingForLayout = false;
		shouldAutoFollow = true;
	}

	return {
		get listEl() {
			return listEl;
		},
		set listEl(value: HTMLDivElement | null) {
			listEl = value;
		},
		get chatTimelineRef() {
			return chatTimelineRef;
		},
		set chatTimelineRef(value: ChatTimelineHandle | null) {
			chatTimelineRef = value;
		},
		get composerHeight() {
			return composerHeight;
		},
		set composerHeight(value: number) {
			composerHeight = value;
		},
		get chatChromeHeight() {
			return chatChromeHeight;
		},
		set chatChromeHeight(value: number) {
			chatChromeHeight = value;
		},
		get shouldAutoFollow() {
			return shouldAutoFollow;
		},
		set shouldAutoFollow(value: boolean) {
			shouldAutoFollow = value;
		},
		get turnMarkerPositions() {
			return turnMarkerPositions;
		},
		set turnMarkerPositions(value: Record<number, number>) {
			if (!areNumberRecordsEqual(turnMarkerPositions, value)) {
				turnMarkerPositions = value;
			}
		},
		get turnMarkerHeights() {
			return turnMarkerHeights;
		},
		set turnMarkerHeights(value: Record<number, number>) {
			if (!areNumberRecordsEqual(turnMarkerHeights, value)) {
				turnMarkerHeights = value;
			}
		},
		clearTurnMarkers,
		get timelineScrollTop() {
			return timelineScrollTop;
		},
		set timelineScrollTop(value: number) {
			timelineScrollTop = value;
		},
		get timelineScrollHeight() {
			return timelineScrollHeight;
		},
		set timelineScrollHeight(value: number) {
			timelineScrollHeight = value;
		},
		get timelineClientHeight() {
			return timelineClientHeight;
		},
		set timelineClientHeight(value: number) {
			timelineClientHeight = value;
		},
		get scrollAnchorBySession() {
			return scrollAnchorBySession;
		},
		set scrollAnchorBySession(value: Map<string, SessionScrollAnchor>) {
			scrollAnchorBySession = value;
		},
		get pendingRestoreSessionId() {
			return pendingRestoreSessionId;
		},
		set pendingRestoreSessionId(value: string | null) {
			pendingRestoreSessionId = value;
		},
		get activeAnchorRestore() {
			return activeAnchorRestore;
		},
		set activeAnchorRestore(value:
			| (SessionScrollAnchor & { sessionId: string })
			| null,) {
			activeAnchorRestore = value;
		},
		get pendingTimelineMarkdownRenders() {
			return pendingTimelineMarkdownRenders;
		},
		set pendingTimelineMarkdownRenders(value: number) {
			pendingTimelineMarkdownRenders = value;
		},
		get anchorRestoreWaitingForLayout() {
			return anchorRestoreWaitingForLayout;
		},
		get vimPendingGActive() {
			return Boolean(vimPendingGTimer);
		},
		set anchorRestoreWaitingForLayout(value: boolean) {
			anchorRestoreWaitingForLayout = value;
		},
		loadSessionScrollAnchors,
		persistSessionScrollAnchorsNow,
		setSessionScrollAnchor,
		getSessionScrollAnchor,
		clearSessionScrollAnchor,
		getMessageElementAbsoluteTop,
		updateTimelineScrollMetrics,
		getTimelineBottomScrollTop,
		updateAutoFollow,
		shouldPinToBottom,
		measureTurnMarkerPositions,
		stopVimScroll,
		scrollTimelineByLines,
		clearPendingVimG,
		armPendingVimG,
		scrollTimelineToTop,
		scrollTimelineToBottom,
		resetSessionScrollUi,
	};
}
