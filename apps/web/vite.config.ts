import { fileURLToPath, URL } from "node:url";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/** Keep each Shiki language/theme package as its own cacheable chunk. */
function shikiPackageChunkName(id: string) {
	const normalized = id.replaceAll("\\", "/");
	const languageMatch = normalized.match(
		/@shikijs\/langs\/dist\/([^/?]+)\.mjs/,
	);
	if (languageMatch?.[1]) return `shiki-lang-${languageMatch[1]}`;

	const themeMatch = normalized.match(/@shikijs\/themes\/dist\/([^/?]+)\.mjs/);
	if (themeMatch?.[1]) return `shiki-theme-${themeMatch[1]}`;

	return null;
}

const docsProductDir = fileURLToPath(
	new URL("../../docs/product", import.meta.url),
);

export default defineConfig({
	resolve: {
		// Workspace package aliases (@cohub/protocol, @neta-art/cohub) live in
		// svelte.config.js `kit.alias`, which SvelteKit injects into Vite for us.
		alias: [
			{
				find: /^\$docs-product\/(.*)$/,
				replacement: `${docsProductDir}/$1`,
			},
		],
	},
	dev: {
		sourcemap: {
			js: true,
			css: true,
		},
	},
	server: {
		allowedHosts: true,
		// Product docs live outside apps/web; allow Vite to read them in dev.
		fs: {
			allow: [docsProductDir],
		},
	},
	build: {
		chunkSizeWarningLimit: 1200,
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: [
						{
							// Dynamic name: each matched package becomes its own chunk;
							// null means leave the module to automatic splitting.
							name: shikiPackageChunkName,
						},
					],
				},
			},
		},
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		VitePWA({
			registerType: undefined,
			injectRegister: null,
			includeAssets: ["robots.txt", "pwa/*.png", "pwa/*.svg"],
			manifest: {
				name: "Cohub",
				short_name: "Cohub",
				description: "AI-powered space collaboration",
				// Keep the installed PWA chrome calm; reserve brand orange for in-app emphasis.
				theme_color: "#1F2026",
				background_color: "#1a1a1a",
				display: "standalone",
				icons: [
					{
						src: "/pwa/icon-192x192.png",
						sizes: "192x192",
						type: "image/png",
					},
					{
						src: "/pwa/icon-512x512.png",
						sizes: "512x512",
						type: "image/png",
					},
					{
						src: "/pwa/icon-maskable-192x192.png",
						sizes: "192x192",
						type: "image/png",
						purpose: "maskable",
					},
					{
						src: "/pwa/icon-maskable-512x512.png",
						sizes: "512x512",
						type: "image/png",
						purpose: "maskable",
					},
				],
			},
			workbox: {
				globPatterns: [
					"**/*.{css,html,ico,png,svg,woff2}",
					"_app/immutable/entry/*.js",
					"_app/immutable/nodes/*.js",
					"_app/version.json",
				],
				importScripts: ["notification-sw.js"],
				navigateFallback: undefined,
				runtimeCaching: [
					{
						urlPattern: ({ url }) =>
							url.pathname.startsWith("/_app/immutable/"),
						handler: "CacheFirst",
						options: {
							cacheName: "immutable-assets",
							expiration: {
								maxEntries: 240,
								maxAgeSeconds: 60 * 60 * 24 * 30,
							},
						},
					},
				],
			},
		}),
	],
});
