import assert from "node:assert/strict";
import {
  isWeakWorkPageMediaRef,
  materializeHtmlPageMeta,
  mergeWorkPageMeta,
  resolveWorkPageAssetRef,
  resolveWorkPageMediaAgainstContentUrl,
  workTitleFromMeta,
} from "./page-meta.js";

const toPublicUrl = (key: string) => `https://cdn.example/${key}`;

assert.equal(
  resolveWorkPageAssetRef("favicon.svg", "w/space/demo/abc/index.html", toPublicUrl),
  "https://cdn.example/w/space/demo/abc/favicon.svg",
);
assert.equal(
  resolveWorkPageAssetRef("/assets/icon.png", "w/space/demo/abc/index.html", toPublicUrl),
  "https://cdn.example/w/space/demo/abc/assets/icon.png",
);
assert.equal(
  resolveWorkPageAssetRef("https://img.example/a.png", "w/space/demo/abc/index.html", toPublicUrl),
  "https://img.example/a.png",
);
assert.equal(
  resolveWorkPageAssetRef("http://img.example/a.png", "w/space/demo/abc/index.html", toPublicUrl),
  null,
);
assert.equal(
  resolveWorkPageAssetRef("https://localhost/a.png", "w/space/demo/abc/index.html", toPublicUrl),
  null,
);
assert.equal(
  resolveWorkPageAssetRef("https://10.0.0.8/a.png", "w/space/demo/abc/index.html", toPublicUrl),
  null,
);
assert.equal(
  resolveWorkPageAssetRef("https://169.254.169.254/latest/meta-data", "w/space/demo/abc/index.html", toPublicUrl),
  null,
);
assert.equal(
  resolveWorkPageAssetRef("../secret.png", "w/space/demo/abc/index.html", toPublicUrl),
  null,
);
assert.equal(
  resolveWorkPageAssetRef(
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    "w/space/demo/abc/index.html",
    toPublicUrl,
  ),
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
);
assert.equal(
  resolveWorkPageMediaAgainstContentUrl(
    "/favicon.svg",
    "https://works.example/dev/w/space/demo/abc/index.html",
  ),
  "https://works.example/dev/w/space/demo/abc/favicon.svg",
);
assert.equal(isWeakWorkPageMediaRef("/favicon.svg"), true);
assert.equal(isWeakWorkPageMediaRef("https://cdn.example/a.png"), false);

const extracted = materializeHtmlPageMeta(
  {
    title: "Board",
    description: "Hello",
    icon: "favicon.ico",
    image: "https://img.example/cover.png",
    lang: "zh-CN",
    themeColor: "#c76b3a",
    sourcePath: "index.html",
  },
  "w/space/demo/abc/index.html",
  toPublicUrl,
  "2026-01-01T00:00:00.000Z",
);
assert.equal(extracted.icon, "https://cdn.example/w/space/demo/abc/favicon.ico");
assert.equal(extracted.image, "https://img.example/cover.png");
assert.equal(extracted.lang, "zh-CN");
assert.equal(extracted.themeColor, "#c76b3a");

// Existing effective fields win; extract only fills blanks and always refreshes snapshot.
const merged = mergeWorkPageMeta(
  { presentation: { hideCohubBar: true }, title: "Manual Title" },
  extracted,
);
assert.equal(merged?.title, "Manual Title");
assert.equal(merged?.description, "Hello");
assert.equal((merged?.presentation as { hideCohubBar?: boolean })?.hideCohubBar, true);
assert.equal((merged?.extracted as { title?: string })?.title, "Board");
assert.equal((merged?.extracted as { sourcePath?: string })?.sourcePath, "index.html");

const filled = mergeWorkPageMeta({ presentation: { hideCohubBar: true } }, extracted);
assert.equal(filled?.title, "Board");

const promoted = mergeWorkPageMeta({ name: "Legacy Name" }, extracted);
assert.equal(promoted?.title, "Legacy Name");
assert.equal(promoted?.name, undefined);

// Weak relative leftovers are upgraded by a solid extracted absolute URL.
const upgraded = mergeWorkPageMeta({ icon: "/favicon.svg" }, extracted);
assert.equal(upgraded?.icon, "https://cdn.example/w/space/demo/abc/favicon.ico");

assert.equal(workTitleFromMeta({ title: "A", name: "B" }, "fallback"), "A");
assert.equal(workTitleFromMeta({ name: "B" }, "fallback"), "B");
assert.equal(workTitleFromMeta(null, "fallback"), "fallback");
