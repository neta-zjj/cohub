export type GenerationStreamResiduals<TContent, TIntermediate> = {
	contentBlocks: TContent[];
	intermediateMessages: TIntermediate[];
	streamMessageId: string | null;
	messageOrdinal: number | null;
	truncatedStart: boolean;
	patchSeq: number;
	finalizedPreview: boolean;
};

export function generationTurnChanged(
	currentTurnId: string | null | undefined,
	nextTurnId: string | null | undefined,
) {
	return Boolean(currentTurnId && nextTurnId && currentTurnId !== nextTurnId);
}

export function emptyGenerationStreamResiduals<
	TContent,
	TIntermediate,
>(): GenerationStreamResiduals<TContent, TIntermediate> {
	return {
		contentBlocks: [],
		intermediateMessages: [],
		streamMessageId: null,
		messageOrdinal: null,
		truncatedStart: false,
		patchSeq: 0,
		finalizedPreview: false,
	};
}

export function resolveGenerationStreamResiduals<TContent, TIntermediate>(
	current: GenerationStreamResiduals<TContent, TIntermediate>,
	reset: boolean,
): GenerationStreamResiduals<TContent, TIntermediate> {
	if (reset) return emptyGenerationStreamResiduals();
	return {
		contentBlocks: current.contentBlocks,
		intermediateMessages: current.intermediateMessages,
		streamMessageId: current.streamMessageId,
		messageOrdinal: current.messageOrdinal,
		truncatedStart: current.truncatedStart,
		patchSeq: current.patchSeq,
		finalizedPreview: current.finalizedPreview,
	};
}

export function resolveGenerationProgressResiduals<TIntermediate>(
	current: Omit<
		GenerationStreamResiduals<never, TIntermediate>,
		"contentBlocks" | "finalizedPreview"
	>,
	input: {
		intermediateMessages?: TIntermediate[];
		streamMessageId?: string | null;
		messageOrdinal?: number | null;
		truncatedStart?: boolean;
		patchSeq?: number;
	},
	turnChanged: boolean,
) {
	return {
		intermediateMessages:
			input.intermediateMessages ??
			(turnChanged ? [] : current.intermediateMessages),
		streamMessageId:
			input.streamMessageId !== undefined
				? input.streamMessageId
				: turnChanged
					? null
					: current.streamMessageId,
		messageOrdinal:
			input.messageOrdinal !== undefined
				? input.messageOrdinal
				: turnChanged
					? null
					: current.messageOrdinal,
		truncatedStart: turnChanged
			? (input.truncatedStart ?? false)
			: (input.truncatedStart ?? current.truncatedStart),
		patchSeq: turnChanged
			? (input.patchSeq ?? 0)
			: (input.patchSeq ?? current.patchSeq),
	};
}

export function removeGenerationStatesForSpace<
	T extends { spaceId?: string | null },
>(states: Record<string, T>, spaceId: string | null | undefined) {
	if (!spaceId) return { remaining: states, removedSessionIds: [] as string[] };

	const remaining: Record<string, T> = {};
	const removedSessionIds: string[] = [];
	for (const [sessionId, state] of Object.entries(states)) {
		if (state.spaceId === spaceId) {
			removedSessionIds.push(sessionId);
		} else {
			remaining[sessionId] = state;
		}
	}
	return { remaining, removedSessionIds };
}
