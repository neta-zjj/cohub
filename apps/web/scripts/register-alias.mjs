/**
 * Node module-resolution registration for the web unit tests.
 *
 * The tests import source modules directly, and those modules import each other
 * the way Vite allows but plain Node does not:
 *
 * - through the SvelteKit `$lib/...` alias;
 * - without a file extension (`./work-page-meta` → `work-page-meta.ts`).
 *
 * Registering both resolutions lets `node --test` load the sources unchanged,
 * rather than each test reaching for exact relative paths — which is why part of
 * the suite (including the board modules) could not run at all.
 */

import { register } from "node:module";

register("./alias-hook.mjs", import.meta.url);
