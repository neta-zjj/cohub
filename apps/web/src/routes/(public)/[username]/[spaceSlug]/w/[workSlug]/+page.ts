import type { PageLoad } from "./$types";

/** Server owns data loading; keep a thin universal load for typing / passthrough. */
export const load: PageLoad = async ({ data }) => data;
