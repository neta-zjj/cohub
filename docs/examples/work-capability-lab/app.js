const DEFAULT_SDK_URL = `https://esm.sh/@neta-art/cohub?bundle&target=es2022`;
const $ = (id) => document.getElementById(id);

const state = {
  module: null,
  client: null,
  context: null,
  space: null,
  token: null,
  parentOrigin: null,
  manifest: null,
};

const statusMap = {
  asset: ["sAsset", "tAsset"],
  import: ["sImport", "tImport"],
  client: ["sClient", "tClient"],
  context: ["sContext", "tContext"],
  wire: ["sWire", "tWire"],
  token: ["sToken", "tToken"],
  config: ["sConfig", "tConfig"],
  files: ["sFiles", "tFiles"],
  sessions: ["sSessions", "tSessions"],
  auth: ["sAuth", "tAuth"],
  prompt: ["sPrompt", "tPrompt"],
  accountSpaces: ["sAccountSpaces", "tAccountSpaces"],
  accountSessions: ["sAccountSessions", "tAccountSessions"],
  accountUsage: ["sAccountUsage", "tAccountUsage"],
};

function detectParentOrigin() {
  try {
    const ancestor = window.location.ancestorOrigins && window.location.ancestorOrigins[0];
    if (ancestor) return ancestor;
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

function setStatus(key, kind, text) {
  const pair = statusMap[key];
  if (!pair) return;
  $(pair[0]).className = "dot" + (kind ? " " + kind : "");
  $(pair[1]).textContent = text;
}

function log(kind, message, detail) {
  const row = document.createElement("div");
  row.className = "event " + kind;
  row.innerHTML = `<time>${new Date().toLocaleTimeString()}</time><span class="kind">${kind}</span><span class="message"></span>`;
  row.querySelector(".message").textContent = detail ? `${message} ${detail}` : message;
  $("log").prepend(row);
}

function renderChips(id, values, granted = true) {
  const el = $(id);
  const list = Array.isArray(values) ? values : [];
  el.innerHTML = "";
  if (!list.length) {
    el.innerHTML = '<span class="chip">none</span>';
    return;
  }
  for (const value of list) {
    const chip = document.createElement("span");
    chip.className = "chip " + (granted ? "ok" : "warn");
    chip.textContent = value;
    el.appendChild(chip);
  }
}

function decodeJwtPayload(token) {
  const part = token && token.split(".")[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = decodeURIComponent(Array.from(atob(padded)).map((char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0")).join(""));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function applyContext(context) {
  state.context = context;
  state.space = context ? state.client.space(context.space.id) : null;
  $("workId").textContent = context?.work?.id || "missing";
  $("workSlug").textContent = context?.work?.slug || "missing";
  $("spaceId").textContent = context?.space?.id || "missing";
  renderChips("workScopes", context?.permissions?.workScopes || [], true);
  renderChips("viewerScopes", context?.permissions?.viewerScopes || [], true);
}

function applyToken(token) {
  state.token = token;
  const payload = decodeJwtPayload(token);
  $("tokenState").textContent = token ? `present (${token.length} chars)` : "empty";
  $("tokenPayload").textContent = payload ? JSON.stringify(payload, null, 2) : "Token received, but payload could not be decoded.";
  if (payload?.workScopes) renderChips("workScopes", payload.workScopes, true);
  if (payload?.viewerScopes) renderChips("viewerScopes", payload.viewerScopes, true);
}

function runtimeRequest(message, timeoutMs = 1800) {
  if (window.parent === window) return Promise.resolve(null);
  const requestId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const parentOrigin = state.parentOrigin || detectParentOrigin();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(event) {
      if (event.source !== window.parent) return;
      if (parentOrigin && event.origin !== parentOrigin) return;
      const data = event.data || {};
      if (data.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      state.parentOrigin = event.origin;
      if (data.type === "cohub.work.error") reject(new Error(data.message || "Runtime request failed."));
      else resolve(data);
    }
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ ...message, requestId }, parentOrigin || "*");
  });
}

async function run(key, fn) {
  setStatus(key, "run", "running");
  try {
    const result = await fn();
    setStatus(key, "ok", "passed");
    return result;
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? error.status : null;
    const kind = status === 401 || status === 403 ? "warn" : "bad";
    setStatus(key, kind, error?.message || "failed");
    log(kind, `${key} failed`, error?.message || String(error));
    throw error;
  }
}

async function probeAssets() {
  return run("asset", async () => {
    const response = await fetch("./assets/lab-manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    state.manifest = await response.json();
    const files = Array.isArray(state.manifest.files) ? state.manifest.files.join(", ") : "no file list";
    log("ok", "Directory assets loaded", `${state.manifest.name || "manifest"} ${state.manifest.version || ""}: ${files}`);
    return state.manifest;
  });
}

async function importSdk() {
  return run("import", async () => {
    const url = $("sdkUrl").value.trim() || DEFAULT_SDK_URL;
    state.module = await import(url);
    if (typeof state.module.createCohubClient !== "function") throw new Error("createCohubClient export is missing.");
    $("sdkStamp").textContent = url;
    log("ok", "SDK imported", url);
    return state.module;
  });
}

async function createClient() {
  return run("client", async () => {
    if (!state.module) await importSdk();
    const baseUrl = $("apiBase").value.trim().replace(/\/+$/, "");
    const options = {
      getAccessToken: (tokenOptions) => getWorkTokenRaw(Boolean(tokenOptions?.forceRefresh)),
    };
    if (baseUrl) options.baseUrl = baseUrl;
    state.client = state.module.createCohubClient(options);
    const methods = [
      typeof state.client.context === "function" ? "context" : "no context",
      state.client.auth?.request ? "auth.request" : "no auth.request",
      state.client.space ? "space" : "no space",
    ].join(" / ");
    $("clientState").textContent = baseUrl ? `ready (${baseUrl})` : `ready (${methods})`;
    log("ok", "Client created", methods);
    return state.client;
  });
}

async function sdkContext() {
  return run("context", async () => {
    if (!state.client) await createClient();
    let context = null;
    if (typeof state.client.context === "function") {
      context = await state.client.context();
      if (context) log("ok", "SDK context loaded", context.work.slug);
    } else {
      log("warn", "SDK context helper missing", "falling back to Work runtime wire protocol");
    }
    if (!context) {
      const response = await runtimeRequest({ type: "cohub.work.context" }, 8000);
      context = response?.context || null;
      if (context) log("ok", "Wire context loaded", context.work.slug);
    }
    if (!context) throw new Error("No Work context. Publish this directory as a Cohub Work to enable it.");
    applyContext(context);
    return context;
  });
}

async function wireContext() {
  return run("wire", async () => {
    const response = await runtimeRequest({ type: "cohub.work.context" }, 8000);
    if (!response?.context) throw new Error("No direct runtime context response.");
    log("ok", "Wire context loaded", response.context.work.slug);
    return response.context;
  });
}

async function getWorkTokenRaw(forceRefresh = false) {
  if (state.token && !forceRefresh) return state.token;
  const response = await runtimeRequest({ type: "cohub.work.token", forceRefresh }, 20000);
  if (!response?.token) return null;
  applyToken(response.token);
  return response.token;
}

async function getRuntimeToken(forceRefresh = false) {
  return run("token", async () => {
    const token = await getWorkTokenRaw(forceRefresh);
    if (!token) throw new Error("No token returned. Sign in and open the published Work.");
    log("ok", forceRefresh ? "Runtime token refreshed" : "Runtime token minted", `${token.length} chars`);
    return token;
  });
}

async function ensureSpace() {
  if (!state.context) await sdkContext();
  if (!state.space) state.space = state.client.space(state.context.space.id);
  return state.space;
}

async function spaceConfig() {
  return run("config", async () => {
    const space = await ensureSpace();
    const result = await space.getConfig();
    log("ok", "space.getConfig() accepted", JSON.stringify(result.config?.sandbox || result).slice(0, 180));
    return result;
  });
}

async function fileTree() {
  return run("files", async () => {
    const space = await ensureSpace();
    const path = $("treePath").value.trim();
    const result = await space.files.list(path);
    const count = Array.isArray(result.entries) ? result.entries.length : "unknown";
    log("ok", "space.files.list() accepted", `${count} entries`);
    return result;
  });
}

async function sessionsList() {
  return run("sessions", async () => {
    const space = await ensureSpace();
    const result = await space.sessions.list({ limit: 5 });
    const count = Array.isArray(result.sessions) ? result.sessions.length : "unknown";
    log("ok", "space.sessions.list() accepted", `${count} sessions`);
    return result;
  });
}

async function requestAuth(scopes) {
  return run("auth", async () => {
    if (!state.client) await createClient();
    let ok = false;
    if (state.client.auth?.request) {
      ok = await state.client.auth.request({
        scopes,
        reason: "Work SDK Lab wants to verify viewer-granted prompt access through the Cohub SDK.",
      });
      if (ok) log("ok", "cohub.auth.request() granted", scopes.join(", "));
    } else {
      log("warn", "SDK auth helper missing", "falling back to Work runtime wire protocol");
      const response = await runtimeRequest({
        type: "cohub.work.authorize",
        scopes,
        reason: "Work SDK Lab wants to verify viewer-granted prompt access through the runtime protocol.",
      }, 120000);
      ok = Boolean(response?.token);
      if (response?.token) applyToken(response.token);
      if (ok) log("ok", "Wire authorization granted", scopes.join(", "));
    }
    if (!ok) throw new Error("Authorization was cancelled or denied.");
    return ok;
  });
}

async function sendPrompt(accessMode) {
  return run("prompt", async () => {
    const space = await ensureSpace();
    const result = await space.prompt({
      accessMode,
      intent: "followup",
      title: "Work SDK Lab",
      content: [{ type: "text", text: $("promptText").value.trim() || "Say one concise observation." }],
    });
    log("ok", `space.prompt(${accessMode}) accepted`, result.sessionId || "session created");
    return result;
  });
}

async function ensureClient() {
  if (!state.client) await createClient();
  return state.client;
}

async function accountSpaces() {
  return run("accountSpaces", async () => {
    const client = await ensureClient();
    const result = await client.spaces.list();
    const list = Array.isArray(result) ? result : result.spaces ?? [];
    log("ok", "spaces.list() accepted", `${list.length} spaces`);
    return result;
  });
}

async function accountSessions() {
  return run("accountSessions", async () => {
    const client = await ensureClient();
    const result = await client.user.listSessions({ limit: 5 });
    const count = Array.isArray(result.sessions) ? result.sessions.length : "unknown";
    log("ok", "user.listSessions() accepted", `${count} sessions`);
    return result;
  });
}

async function accountUsage() {
  return run("accountUsage", async () => {
    const client = await ensureClient();
    const result = await client.user.getUsage(30);
    log("ok", "user.getUsage() accepted", `${result.summary?.totalTokens ?? 0} tokens, ${result.summary?.costTotal ?? 0}`);
    return result;
  });
}

async function bootstrap() {
  try {
    await probeAssets();
    await importSdk();
    await createClient();
    await sdkContext();
    await getRuntimeToken(false).catch(() => null);
  } catch (error) {
    log("warn", "Bootstrap incomplete", error?.message || String(error));
  }
}

$("sdkUrl").value = DEFAULT_SDK_URL;
state.parentOrigin = detectParentOrigin();
$("modeStamp").textContent = window.parent === window ? "Standalone preview" : "Cohub iframe";
$("parentStamp").textContent = state.parentOrigin ? new URL(state.parentOrigin).host : "standalone";
log("info", "Lab loaded", window.parent === window ? "standalone" : "iframe mode");

$("assetProbe").onclick = () => probeAssets().catch(() => {});
$("importSdk").onclick = () => importSdk().catch(() => {});
$("createClient").onclick = () => createClient().catch(() => {});
$("sdkContext").onclick = () => sdkContext().catch(() => {});
$("wireContext").onclick = () => wireContext().catch(() => {});
$("getToken").onclick = () => getRuntimeToken(false).catch(() => {});
$("refreshToken").onclick = () => getRuntimeToken(true).catch(() => {});
$("spaceConfig").onclick = () => spaceConfig().catch(() => {});
$("fileTree").onclick = () => fileTree().catch(() => {});
$("sessionsList").onclick = () => sessionsList().catch(() => {});
$("authReadonly").onclick = () => requestAuth(["session.prompt.readonly"]).catch(() => {});
$("authFull").onclick = () => requestAuth(["session.prompt.fullaccess"]).catch(() => {});
$("promptReadonly").onclick = () => sendPrompt("read_only").catch(() => {});
$("promptFull").onclick = () => sendPrompt("full_access").catch(() => {});
$("accountSpacesBtn").onclick = () => accountSpaces().catch(() => {});
$("accountSessionsBtn").onclick = () => accountSessions().catch(() => {});
$("accountUsageBtn").onclick = () => accountUsage().catch(() => {});
$("runReadSuite").onclick = async () => {
  try { await ensureSpace(); } catch (error) { log("warn", "Read suite stopped", error?.message || String(error)); return; }
  await spaceConfig().catch(() => {});
  await fileTree().catch(() => {});
  await sessionsList().catch(() => {});
};
$("bootstrap").onclick = () => bootstrap();
$("clearLog").onclick = () => { $("log").innerHTML = ""; };

bootstrap();
