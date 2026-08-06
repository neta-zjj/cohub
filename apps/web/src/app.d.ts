// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			workspacePreview?: string | null;
		}
		// interface Platform {}
	}
}

declare module "$env/static/public" {
	export const PUBLIC_PREVIEW_ORIGIN: string | undefined;
}

export {};
