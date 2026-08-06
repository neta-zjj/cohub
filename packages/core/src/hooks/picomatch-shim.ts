import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type PicomatchFn = (glob: string | string[], options?: { dot?: boolean }) => (input: string) => boolean;

// picomatch is CJS without bundled types; typed shim avoids ambient .d.ts resolution issues.
export const picomatch: PicomatchFn = require("picomatch");
