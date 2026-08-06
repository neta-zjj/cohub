import {
	parseWorkspaceDefaultLayout,
	type WorkspaceDefaultLayout,
	type WorkspaceLayoutPresentation,
} from "@cohub/protocol";

export {
	parseWorkspaceDefaultLayout,
	type WorkspaceDefaultLayout,
	type WorkspaceLayoutPresentation,
};

/** Resolved presentation for the workspace layout controller / uiState. */
export type ResolvedPresentation = "default" | "focus" | "immersive";

/** Base (pre-presentation) geometry resolved from a default layout. */
export type ResolvedDefaultLayoutGeometry = {
	leftSidebarCollapsed: boolean;
	rightSidebarCollapsed: boolean;
	filesColumnHidden: boolean;
	presentation: ResolvedPresentation;
	/** Whether the configured preview should be opened for this fresh entry. */
	openPreview: boolean;
};

/**
 * Resolve a space default layout into concrete base geometry. Pure so the
 * precedence rules (explicit route preview wins, presentation needs a preview)
 * stay testable independent of uiState.
 *
 * @param hasRoutePreview whether the URL already carries an explicit `?preview=`.
 */
export function resolveDefaultLayoutGeometry(
	layout: WorkspaceDefaultLayout,
	hasRoutePreview: boolean,
): ResolvedDefaultLayoutGeometry {
	const hasPreview = Boolean(layout.preview) || hasRoutePreview;
	const presentation: ResolvedPresentation =
		hasPreview && layout.presentation === "focus"
			? "focus"
			: hasPreview && layout.presentation === "fullscreen"
				? "immersive"
				: "default";
	return {
		leftSidebarCollapsed: layout.leftSidebar === "collapsed",
		rightSidebarCollapsed: layout.fileTree === "collapsed",
		// Never hide the Files column while a preview (config or explicit URL)
		// needs to render — explicit preview must win over `filesColumn: hidden`.
		filesColumnHidden: layout.filesColumn === "hidden" && !hasPreview,
		presentation,
		openPreview: Boolean(layout.preview),
	};
}
