#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import process from "node:process";

const env = process.env;

function fail(message) {
  process.stderr.write(`[k-lani-codex-agent] ${message}\n`);
  process.exit(2);
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function validateSingleLine(name, value, pattern) {
  if (!value || /[\r\n]/.test(value)) {
    fail(`${name} must be a non-empty single-line value`);
  }
  if (pattern && !pattern.test(value)) {
    fail(`${name} has an invalid value: ${value}`);
  }
  return value;
}

function validateOptionalTicket(value) {
  if (!value) {
    return "";
  }
  if (!/^[0-9a-fA-F]{8}$/.test(value)) {
    fail("KLANI_TICKET must be exactly 8 hexadecimal characters");
  }
  return value.toLowerCase();
}

function normalizeHubTokenEnv(value) {
  const name = String(value || "").trim();
  if (!name) {
    return "";
  }
  if (!/^[A-Z0-9_]+$/.test(name)) {
    throw new Error("KLANI_HUB_TOKEN_ENV must name an uppercase env var");
  }
  return name;
}

function normalizeBilling(value) {
  const billing = String(value || "subscription").trim().toLowerCase();
  if (billing === "subscription" || billing === "api") {
    return billing;
  }
  throw new Error("KLANI_BILLING must be subscription or api");
}

function parseBooleanEnv(value, defaultValue) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return defaultValue;
  }
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") {
    return false;
  }
  throw new Error(`expected boolean environment value, got ${value}`);
}

function normalizeMcpMode(value) {
  const mode = String(value || "required").trim().toLowerCase();
  if (mode === "required" || mode === "none") {
    return mode;
  }
  throw new Error("KLANI_MCP_MODE must be required or none");
}

function normalizeOneShotOutputMode(value) {
  const mode = String(value || "schema").trim().toLowerCase();
  if (mode === "schema" || mode === "framed_json") {
    return mode;
  }
  throw new Error("KLANI_CODEX_ONE_SHOT_OUTPUT_MODE must be schema or framed_json");
}

const CODEX_RUNTIME_PROFILES = new Set([
  "native_default",
  "codex_one_shot_minimal",
  "codex_one_shot_with_gate",
  "codex_mcp_limited",
  "codex_mcp_full",
  "codex_mcp_full_legacy",
]);

function normalizeRuntimeProfile(value, mcpMode) {
  const raw = String(value || "").trim();
  const profile = raw || (mcpMode === "none" ? "codex_one_shot_with_gate" : "codex_mcp_full_legacy");
  if (CODEX_RUNTIME_PROFILES.has(profile)) {
    return profile;
  }
  throw new Error(`KLANI_CODEX_RUNTIME_PROFILE must be one of ${[...CODEX_RUNTIME_PROFILES].join(", ")}`);
}

function runtimeProfileDefaults(profile) {
  switch (profile) {
    case "native_default":
      return { mcpMode: "none", shellTool: true, enabledTools: [] };
    case "codex_one_shot_minimal":
      return { mcpMode: "none", shellTool: false, enabledTools: [] };
    case "codex_one_shot_with_gate":
      return { mcpMode: "none", shellTool: true, enabledTools: [] };
    case "codex_mcp_limited":
      return { mcpMode: "required", shellTool: false, enabledTools: ["ticket", "overview", "search", "context", "file", "write", "check"] };
    case "codex_mcp_full":
    case "codex_mcp_full_legacy":
      return { mcpMode: "required", shellTool: true, enabledTools: [] };
    default:
      throw new Error(`unknown Codex runtime profile ${profile}`);
  }
}

function shouldUseOneShotOutputSchema(runtimeProfile, oneShotResultPath, oneShotOutputMode = "schema") {
  if (!oneShotResultPath) {
    return false;
  }
  if (normalizeOneShotOutputMode(oneShotOutputMode) !== "schema") {
    return false;
  }
  return runtimeProfile === "codex_one_shot_minimal" ||
    runtimeProfile === "codex_one_shot_with_gate";
}

function framedOneShotInstruction() {
  return [
    "Return exactly one framed result block.",
    "Do not wrap it in Markdown.",
    "Put valid JSON between KLANI_ONE_SHOT_RESULT_BEGIN and KLANI_ONE_SHOT_RESULT_END.",
    "The JSON shape is:",
    '{"status":"patch|needs_context|reject","files":[{"path":"workspace/relative/file","mode":"replace|new_file","original_hash":"optional fnv1a64 hex","content":"full file content"}],"tests_to_run":[],"assumptions":[],"needs_context":[]}',
    "The host applies returned files through guarded k-lani-coder writeback.",
  ].join("\n");
}

function buildOneShotPrompt({ prompt, oneShotResultPath, oneShotOutputMode }) {
  if (!oneShotResultPath || normalizeOneShotOutputMode(oneShotOutputMode) !== "framed_json") {
    return prompt;
  }
  if (prompt.includes("KLANI_ONE_SHOT_RESULT_BEGIN")) {
    return prompt;
  }
  return `${prompt.trim()}\n\n${framedOneShotInstruction()}`;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function codexProfileConfigArgs({ runtimeProfile, shellTool }) {
  if (runtimeProfile === "native_default") {
    return [];
  }
  const args = [
    "-c",
    'web_search="disabled"',
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    'history.persistence="none"',
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.shell_snapshot=false",
  ];
  if (!shellTool || runtimeProfile === "codex_one_shot_minimal") {
    args.push("-c", "features.shell_tool=false");
  }
  return args;
}

function assertNoApiKeysForSubscription(billing, sourceEnv) {
  if (billing !== "subscription") {
    return;
  }
  const keys = ["CODEX_API_KEY", "OPENAI_API_KEY"].filter((name) => {
    const value = sourceEnv[name];
    return value !== undefined && String(value).trim() !== "";
  });
  if (keys.length) {
    throw new Error(
      `KLANI_BILLING=subscription refuses API key environment (${keys.join(", ")}). ` +
        "Remove these variables to stay on ChatGPT/Codex subscription auth.",
    );
  }
}

function normalizeProxyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/[\r\n]/.test(raw)) {
    throw new Error("KLANI_CODEX_PROXY_URL must be a single-line URL");
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("KLANI_CODEX_PROXY_URL must be a valid http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("KLANI_CODEX_PROXY_URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new Error("KLANI_CODEX_PROXY_URL must not contain credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("KLANI_CODEX_PROXY_URL must not contain query or fragment parts");
  }
  return parsed.href.endsWith("/") ? parsed.href.slice(0, -1) : parsed.href;
}

function proxyRole(role) {
  return role === "reviewer" ? "review" : role;
}

function buildTicketProxyUrl({ proxyBaseUrl, ticket, role }) {
  const baseUrl = normalizeProxyUrl(proxyBaseUrl);
  if (!baseUrl || !ticket) {
    return "";
  }
  const root = baseUrl.endsWith("/v1") ? baseUrl.slice(0, -3) : baseUrl;
  return `${root}/t/${ticket.toLowerCase()}/${proxyRole(role)}/v1`;
}

function resolveCodexProxyUrl({ explicitProxyUrl, proxyBaseUrl, ticket, role }) {
  const explicit = normalizeProxyUrl(explicitProxyUrl);
  if (explicit) {
    return explicit;
  }
  return buildTicketProxyUrl({ proxyBaseUrl, ticket, role });
}

function buildProxyProviderArgs({ proxyUrl, agentId, billing }) {
  const baseUrl = normalizeProxyUrl(proxyUrl);
  if (!baseUrl) {
    return [];
  }
  const authField = billing === "subscription"
    ? "requires_openai_auth=true"
    : `env_key=${tomlString("OPENAI_API_KEY")}`;
  const provider =
    `{name=${tomlString("K-Lani Codex Pro Proxy")}, base_url=${tomlString(baseUrl)}, ` +
    `wire_api="responses", ${authField}, http_headers={"X-Agent-ID"=${tomlString(agentId)}}}`;
  return [
    "-c",
    `model_provider=${tomlString("k_lani_proxy")}`,
    "-c",
    `model_providers.k_lani_proxy=${provider}`,
  ];
}

function buildPromptInputArgs({ model, effort, mcpConfig, providerArgs, profileArgs = [], prompt }) {
  return [
    "debug",
    "prompt-input",
    "-c",
    `model=${tomlString(model)}`,
    "-c",
    `model_reasoning_effort=${tomlString(effort)}`,
    "-c",
    "hide_agent_reasoning=true",
    ...profileArgs,
    ...providerArgs,
    ...mcpConfigArgs(mcpConfig),
    prompt,
  ];
}

function buildOtelLivenessArgs({ endpoint, agentId, ticket, role, phase, model, effort, billing }) {
  const headers = [
    `"x-k-lani-agent"=${tomlString(agentId)}`,
    `"x-k-lani-role"=${tomlString(role)}`,
    `"x-k-lani-phase"=${tomlString(phase)}`,
    `"x-k-lani-model"=${tomlString(model)}`,
    `"x-k-lani-effort"=${tomlString(effort)}`,
    `"x-k-lani-billing"=${tomlString(billing)}`,
  ];
  if (ticket) {
    headers.push(`"x-k-lani-ticket"=${tomlString(ticket)}`);
  }
  return [
    "-c",
    'otel.environment="k-lani"',
    "-c",
    "otel.log_user_prompt=false",
    "-c",
    `otel.exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json",headers={${headers.join(",")}}}}`,
  ];
}

function mcpConfigArgs(mcpConfig) {
  return mcpConfig ? ["-c", `mcp_servers.k_lani_coder=${mcpConfig}`] : [];
}

function buildMcpConfig({ hub, agentId, level, ticket, workdir, hubTokenEnv = "", enabledTools = [] }) {
  const bridgeArgs = [
    "serve",
    "--connect",
    hub,
    "--agent-id",
    agentId,
    "--level",
    level,
  ];
  if (ticket) {
    bridgeArgs.push("--ticket", ticket);
  }
  if (hubTokenEnv) {
    bridgeArgs.push("--hub-token-env", hubTokenEnv);
  }
  const bridgeArgsToml = `[${bridgeArgs.map(tomlString).join(",")}]`;
  const enabledToolsToml = enabledTools.length
    ? `, enabled_tools=[${enabledTools.map(tomlString).join(",")}]`
    : "";
  return (
    `{command="/usr/local/bin/k-lani-coder", args=${bridgeArgsToml}, ` +
    `cwd=${tomlString(workdir)}, required=true, default_tools_approval_mode="approve"${enabledToolsToml}}`
  );
}

function spawnInherit(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    }
    process.exit(code ?? 1);
  });
  child.on("error", (error) => fail(`${command} failed to start: ${error.message}`));
}

function readStdin() {
  if (process.stdin.isTTY) {
    return Promise.resolve("");
  }
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text.trim()));
    process.stdin.on("error", reject);
  });
}

function usageFilePath() {
  return `${env.KLANI_USAGE_DIR || "/usage"}/codex-usage.ndjson`;
}

function runManifestPath(usageSummaryPath) {
  return `${usageSummaryPath.slice(0, usageSummaryPath.lastIndexOf("/") + 1)}run-manifests.ndjson`;
}

function diagnosticPath(usageDir, prefix, runId, suffix) {
  return `${usageDir}/${prefix}-${runId}.${suffix}`;
}

function previewText(value, maxLength = 500) {
  if (value === undefined || value === null) {
    return "";
  }
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function itemText(item) {
  if (!item) {
    return "";
  }
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.message === "string") {
    return item.message;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  if (Array.isArray(item.content)) {
    return item.content
      .filter((part) => part && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

function progressReference(state) {
  const eventMs = state.lastEventAtMs || 0;
  const otelMs = state.otelLastAtMs || 0;
  if (otelMs > eventMs) {
    return { ms: otelMs, kind: "otel_liveness" };
  }
  if (eventMs > 0) {
    return { ms: eventMs, kind: "codex_json_event" };
  }
  if (state.startedAtMs) {
    return { ms: state.startedAtMs, kind: "run_start" };
  }
  return { ms: 0, kind: "" };
}

function writeRunStateRecord(state, kind, extra = {}) {
  if (!state.runStatePath) {
    return;
  }
  const now = new Date().toISOString();
  const progress = progressReference(state);
  const record = {
    source: "codex_exec_json",
    kind,
    ts: now,
    run_id: state.runId,
    ticket: state.ticket || null,
    role: state.role,
    phase: state.phase || state.role,
    agent: state.agentId,
    model: state.model,
    effort: state.effort,
    runtime_profile: state.runtimeProfile,
    one_shot_output_mode: state.oneShotOutputMode || null,
    mcp_mode: state.mcpMode,
    enabled_tools: state.enabledTools,
    turn_count: state.turnCount || 0,
    mcp_tool_calls: state.mcpToolCalls || 0,
    command_executions: state.commandExecutions || 0,
    web_searches: state.webSearches || 0,
    agent_messages: state.agentMessages || 0,
    elapsed_ms: state.startedAtMs ? Date.now() - state.startedAtMs : null,
    last_event_type: state.lastEventType || null,
    ms_since_last_event: state.lastEventAtMs ? Date.now() - state.lastEventAtMs : null,
    last_progress_kind: progress.kind || null,
    ms_since_progress: progress.ms ? Date.now() - progress.ms : null,
    stdout_bytes: state.stdoutBytes || 0,
    stderr_bytes: state.stderrBytes || 0,
    otel_liveness_enabled: state.otelLivenessEnabled || false,
    otel_liveness_endpoint: state.otelLivenessEndpoint || null,
    otel_requests: state.otelRequests || 0,
    otel_payload_bytes: state.otelPayloadBytes || 0,
    otel_events: state.otelEvents || 0,
    otel_api_requests: state.otelApiRequests || 0,
    otel_sse_events: state.otelSseEvents || 0,
    otel_websocket_events: state.otelWebsocketEvents || 0,
    otel_output_text_deltas: state.otelOutputTextDeltas || 0,
    otel_response_in_progress: state.otelResponseInProgress || 0,
    otel_response_completed: state.otelResponseCompleted || 0,
    otel_parse_errors: state.otelParseErrors || 0,
    otel_last_event_name: state.otelLastEventName || null,
    otel_last_event_kind: state.otelLastEventKind || null,
    ms_since_otel_liveness: state.otelLastAtMs ? Date.now() - state.otelLastAtMs : null,
    events_path: state.eventsPath || null,
    stderr_path: state.stderrPath || null,
    ...extra,
  };
  appendFileSync(state.runStatePath, `${JSON.stringify(record)}\n`);
}

function recordCodexEvent(event, state) {
  if (!event || !event.type) {
    return;
  }
  state.lastEventType = event.type;
  state.lastEventAtMs = Date.now();
  state.eventCount = (state.eventCount || 0) + 1;

  const item = event.item || null;
  const extra = {
    event_type: event.type,
    event_count: state.eventCount,
    thread_id: event.thread_id || state.threadId || null,
    item_type: item && item.type ? item.type : null,
    item_status: item && item.status ? item.status : null,
    tool_name: item && (item.tool || item.name || item.tool_name) ? (item.tool || item.name || item.tool_name) : null,
    command: item && item.command ? previewText(item.command, 300) : null,
    message: event.message ? previewText(event.message) : null,
    error: event.error ? previewText(event.error) : null,
    text_preview: item ? previewText(itemText(item)) : "",
  };
  writeRunStateRecord(state, "event", extra);
}

function otlpAttributeValue(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return String(value.stringValue);
  if (Object.prototype.hasOwnProperty.call(value, "intValue")) return Number(value.intValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "boolValue")) return Boolean(value.boolValue);
  return value;
}

function otlpAttributes(attrs) {
  const out = new Map();
  if (!Array.isArray(attrs)) {
    return out;
  }
  for (const attr of attrs) {
    const key = attr && typeof attr.key === "string" ? attr.key : "";
    if (!key || !attr || !attr.value) {
      continue;
    }
    out.set(key, otlpAttributeValue(attr.value));
  }
  return out;
}

function attrString(attrs, keys) {
  for (const key of keys) {
    const value = attrs.get(key);
    if (value !== undefined && value !== null && value !== "") {
      return String(value);
    }
  }
  return "";
}

function extractOtelLiveness(jsonText) {
  const stats = {
    events: 0,
    apiRequests: 0,
    sseEvents: 0,
    websocketEvents: 0,
    outputTextDeltas: 0,
    responseInProgress: 0,
    responseCompleted: 0,
    lastEventName: "",
    lastEventKind: "",
  };
  const root = JSON.parse(jsonText);
  const resourceLogs = Array.isArray(root.resourceLogs) ? root.resourceLogs : [];
  for (const resource of resourceLogs) {
    const scopeLogs = Array.isArray(resource?.scopeLogs) ? resource.scopeLogs : [];
    for (const scope of scopeLogs) {
      const records = Array.isArray(scope?.logRecords) ? scope.logRecords : [];
      for (const record of records) {
        const attrs = otlpAttributes(record?.attributes);
        const eventName = attrString(attrs, ["event.name", "event_name", "name"]);
        const eventKind = attrString(attrs, ["event.kind", "event_kind", "kind"]);
        if (!eventName.startsWith("codex.")) {
          continue;
        }
        stats.events += 1;
        stats.lastEventName = eventName;
        stats.lastEventKind = eventKind;
        if (eventName === "codex.api_request") stats.apiRequests += 1;
        if (eventName === "codex.sse_event") stats.sseEvents += 1;
        if (eventName === "codex.websocket_event") stats.websocketEvents += 1;
        if (eventKind === "response.output_text.delta") stats.outputTextDeltas += 1;
        if (eventKind === "response.in_progress") stats.responseInProgress += 1;
        if (eventKind === "response.completed") stats.responseCompleted += 1;
      }
    }
  }
  return stats;
}

function applyOtelLiveness(state, stats) {
  state.otelEvents += stats.events || 0;
  state.otelApiRequests += stats.apiRequests || 0;
  state.otelSseEvents += stats.sseEvents || 0;
  state.otelWebsocketEvents += stats.websocketEvents || 0;
  state.otelOutputTextDeltas += stats.outputTextDeltas || 0;
  state.otelResponseInProgress += stats.responseInProgress || 0;
  state.otelResponseCompleted += stats.responseCompleted || 0;
  if (stats.lastEventName) state.otelLastEventName = stats.lastEventName;
  if (stats.lastEventKind) state.otelLastEventKind = stats.lastEventKind;
}

function startOtelLivenessServer(state) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const chunks = [];
      let bytes = 0;
      let keepBody = true;
      request.on("data", (chunk) => {
        bytes += chunk.length;
        if (keepBody && bytes <= 1_000_000) {
          chunks.push(chunk);
        } else {
          keepBody = false;
          chunks.length = 0;
        }
      });
      request.on("end", () => {
        state.otelRequests += 1;
        state.otelPayloadBytes += bytes;
        state.otelLastAtMs = Date.now();
        let stats = {
          events: 0,
          apiRequests: 0,
          sseEvents: 0,
          websocketEvents: 0,
          outputTextDeltas: 0,
          responseInProgress: 0,
          responseCompleted: 0,
        };
        let parseError = "";
        if (keepBody && request.method === "POST" && request.url?.startsWith("/v1/logs")) {
          try {
            stats = extractOtelLiveness(Buffer.concat(chunks).toString("utf8"));
            applyOtelLiveness(state, stats);
          } catch (error) {
            state.otelParseErrors += 1;
            parseError = error && error.message ? error.message : String(error);
          }
        }
        writeRunStateRecord(state, "otel_liveness", {
          otel_request_path: request.url || "",
          otel_request_method: request.method || "",
          otel_request_bytes: bytes,
          otel_body_discarded: !keepBody,
          otel_batch_events: stats.events || 0,
          otel_batch_api_requests: stats.apiRequests || 0,
          otel_batch_sse_events: stats.sseEvents || 0,
          otel_batch_websocket_events: stats.websocketEvents || 0,
          otel_batch_output_text_deltas: stats.outputTextDeltas || 0,
          otel_batch_response_in_progress: stats.responseInProgress || 0,
          otel_batch_response_completed: stats.responseCompleted || 0,
          otel_parse_error: parseError || null,
        });
        const body = JSON.stringify({ partialSuccess: {} });
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Content-Length": Buffer.byteLength(body),
        });
        response.end(body);
      });
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      if (!port) {
        server.close();
        reject(new Error("OTEL liveness server did not bind a TCP port"));
        return;
      }
      resolve({
        server,
        endpoint: `http://127.0.0.1:${port}/v1/logs`,
      });
    });
  });
}

function closeOtelLivenessServer(otelLiveness) {
  if (otelLiveness && otelLiveness.server) {
    otelLiveness.server.close();
  }
}

function heartbeatMsFromEnv(sourceEnv = env) {
  const value = Number(sourceEnv.KLANI_AGENT_HEARTBEAT_MS || 15000);
  return Number.isFinite(value) && value >= 1000 ? value : 15000;
}

function noProgressTimeoutMsFromEnv(sourceEnv = env) {
  const raw = String(sourceEnv.KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS || "").trim();
  if (!raw) {
    return 180000;
  }
  const value = Number(raw);
  if (value === 0) {
    return 0;
  }
  return Number.isFinite(value) && value >= 10000 ? value : 180000;
}

function silentTurnTimeoutMsFromEnv(sourceEnv = env) {
  const raw = String(sourceEnv.KLANI_AGENT_SILENT_TURN_TIMEOUT_MS || "").trim();
  if (!raw) {
    return 0;
  }
  const value = Number(raw);
  if (value === 0) {
    return 0;
  }
  return Number.isFinite(value) && value >= 60000 ? value : 0;
}

function shouldAbortForNoProgress(state, nowMs, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) {
    return false;
  }
  const referenceMs = progressReference(state).ms;
  if (!referenceMs) {
    return false;
  }
  return nowMs - referenceMs >= timeoutMs;
}

function shouldAbortForSilentTurn(state, nowMs, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0 || !state.inTurn || !state.turnStartedAtMs) {
    return false;
  }
  const referenceMs = Math.max(state.turnStartedAtMs || 0, progressReference(state).ms);
  if (!referenceMs) {
    return false;
  }
  return nowMs - referenceMs >= timeoutMs;
}

function printUsageLog() {
  try {
    process.stdout.write(readFileSync(usageFilePath(), "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return;
    }
    fail(`could not read usage log: ${error.message}`);
  }
}

function help() {
  process.stdout.write(`Usage:
  codex-agent login
      Run 'codex login --device-auth' inside the container.

  codex-agent run [prompt...]
      Run Codex non-interactively with k-lani-coder as the required MCP server.
      If no prompt argument is supplied, KLANI_PROMPT is used. Set
      KLANI_READ_STDIN=1 to read the prompt from stdin.

  codex-agent usage
      Print /usage/codex-usage.ndjson.

Important environment:
  KLANI_HUB                 default 127.0.0.1:8790
  KLANI_HUB_TOKEN_ENV       optional env-var name read by the Rust bridge
  KLANI_AGENT_ID            exact model deployment identity
  KLANI_MODEL               default gpt-5.5
  KLANI_REASONING_EFFORT    minimal|none|low|medium|high|xhigh
  KLANI_TICKET              optional 8-hex board ticket id
  KLANI_ROLE                planner|worker|reviewer
  KLANI_PHASE               optional single-line phase label, default role
  KLANI_LEVEL               1|2|3
  KLANI_MCP_MODE            required|none, default required
  KLANI_CODEX_RUNTIME_PROFILE
                            native_default|codex_one_shot_minimal|codex_one_shot_with_gate|
                            codex_mcp_limited|codex_mcp_full|codex_mcp_full_legacy
  KLANI_CODEX_ENABLED_TOOLS optional comma list for codex_mcp_limited
  KLANI_CODEX_ONE_SHOT_OUTPUT_MODE
                            schema|framed_json, default schema
  KLANI_CODEX_SANDBOX       read-only|workspace-write|danger-full-access, default read-only
  KLANI_BILLING             subscription|api, default subscription
  KLANI_CODEX_HOME_ISOLATED 1 when CODEX_HOME is a fresh per-run auth-only home
  KLANI_CODEX_HOME_MODE     e.g. auth-only-fresh
  KLANI_CODEX_HOME_LABEL    short evidence label for the run
  KLANI_CODEX_HOME_MANIFEST_PATH
                            host-visible manifest for the prepared CODEX_HOME
  KLANI_CODEX_PROXY_URL     optional /v1 base URL for k-lani-ai-proxy
  KLANI_CODEX_PROXY_BASE_URL
                            optional proxy root; with KLANI_TICKET derives
                            /t/<ticket>/<role>/v1 for API-key attribution
  KLANI_CAPTURE_PROMPT_INPUT
                            0 by default; writes codex-prompt-input-*.json
  KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS
                            abort only after no visible event or OTEL liveness,
                            default 180000, 0 disables
  KLANI_AGENT_SILENT_TURN_TIMEOUT_MS
                            optional active-turn silence abort, default 0
  KLANI_CODEX_OTEL_LIVENESS
                            1 by default; counts local OTEL events without storing payloads
  KLANI_PROMPT              prompt for run mode
  KLANI_READ_STDIN          set to 1 to read prompt from stdin

Subscription billing refuses CODEX_API_KEY and OPENAI_API_KEY. With
KLANI_CODEX_PROXY_URL it configures Codex with requires_openai_auth=true, so
the run still uses the ChatGPT/Codex login stored in CODEX_HOME. For exact
pay-per-token API attribution, use KLANI_BILLING=api plus OPENAI_API_KEY
(a dummy value is enough when the proxy vault injects the real key) and set
KLANI_CODEX_PROXY_BASE_URL with KLANI_TICKET.
`);
}

function parseCodexLine(line, state, usageSummaryPath) {
  if (!line.trim()) {
    return;
  }
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  recordCodexEvent(event, state);
  if (event.type === "thread.started" && event.thread_id) {
    state.threadId = event.thread_id;
    return;
  }
  if (event.type === "turn.started") {
    state.turnCount += 1;
    state.inTurn = true;
    state.turnStartedAtMs = Date.now();
    return;
  }
  if (event.type === "turn.completed" || event.type === "turn.failed") {
    state.inTurn = false;
    state.turnStartedAtMs = 0;
  }
  if ((event.type === "item.started" || event.type === "item.completed") && event.item) {
    const itemType = event.item.type || "";
    if (event.type === "item.completed") {
      if (itemType === "mcp_tool_call") state.mcpToolCalls += 1;
      if (itemType === "command_execution") state.commandExecutions += 1;
      if (itemType === "web_search") state.webSearches += 1;
      if (itemType === "agent_message") state.agentMessages += 1;
    }
  }
  if (event.type !== "turn.completed" || !event.usage) {
    return;
  }

  const usage = event.usage;
  const endedAt = new Date().toISOString();
  const input = Number(usage.input_tokens || 0);
  const cachedInput = Number(usage.cached_input_tokens || 0);
  const output = Number(usage.output_tokens || 0);
  const reasoning = Number(usage.reasoning_output_tokens || 0);
  const total = Number(usage.total_tokens || input + output);
  const nativeUsage = state.runtimeProfile === "native_default";
  const ephemeral = state.ephemeral !== undefined ? state.ephemeral : !nativeUsage;
  const ignoreUserConfig = state.ignoreUserConfig !== undefined ? state.ignoreUserConfig : !nativeUsage;
  const ignoreRules = state.ignoreRules !== undefined ? state.ignoreRules : !nativeUsage;
  const projectDocMaxBytes = state.projectDocMaxBytes !== undefined
    ? state.projectDocMaxBytes
    : (nativeUsage ? null : 0);
  const record = {
    source: "codex_exec_json",
    billing: state.billing,
    ts: endedAt,
    started_ts: state.startedAt || null,
    ended_ts: endedAt,
    attribution: state.ticket ? "exact" : "unattributed",
    run_id: state.runId,
    thread_id: state.threadId || null,
    ticket: state.ticket || null,
    role: state.role,
    phase: state.phase || state.role,
    agent: state.agentId,
    model: state.model,
    effort: state.effort,
    runtime_profile: state.runtimeProfile,
    one_shot_output_mode: state.oneShotOutputMode || null,
    mcp_mode: state.mcpMode,
    enabled_tools: state.enabledTools,
    turn_count: state.turnCount,
    mcp_tool_calls: state.mcpToolCalls,
    command_executions: state.commandExecutions,
    web_searches: state.webSearches,
    agent_messages: state.agentMessages,
    context_pack_path: state.contextPackPath || null,
    context_pack_sha256: state.contextPackSha256 || null,
    context_pack_bytes: state.contextPackBytes || 0,
    context_pack_estimated_tokens: state.contextPackEstimatedTokens || 0,
    one_shot_result_path: state.oneShotResultPath || null,
    codex_home_isolated: state.codexHomeIsolated,
    codex_home_mode: state.codexHomeMode || null,
    codex_home_label: state.codexHomeLabel || null,
    codex_home_manifest_path: state.codexHomeManifestPath || null,
    prompt_input_capture: state.promptInputCapture,
    session_mode: "fresh",
    ephemeral,
    resume: false,
    ignore_user_config: ignoreUserConfig,
    ignore_rules: ignoreRules,
    project_doc_max_bytes: projectDocMaxBytes,
    proxy_url: state.proxyUrl || null,
    events_path: state.eventsPath || null,
    run_state_path: state.runStatePath || null,
    stderr_path: state.stderrPath || null,
    last_event_type: state.lastEventType || null,
    ms_since_last_event: state.lastEventAtMs ? Date.now() - state.lastEventAtMs : null,
    prompt_input_path: state.promptInputPath || null,
    input_tokens: input,
    cached_input_tokens: cachedInput,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total,
    cost_micros: null,
  };
  appendFileSync(usageSummaryPath, `${JSON.stringify(record)}\n`);
  if (record.attribution === "exact") {
    appendFileSync(
      runManifestPath(usageSummaryPath),
      `${JSON.stringify({
        ...record,
        source: "subscription_run_manifest",
        manifest_kind: "subscription_role_run",
        manifest_version: 1,
      })}\n`,
    );
  }
  process.stderr.write(
    `[k-lani-codex-usage] agent=${state.agentId} model=${state.model} effort=${state.effort} ` +
      `ticket=${state.ticket || "-"} role=${state.role} phase=${record.phase} ` +
      `input_tokens=${input} cached_input_tokens=${cachedInput} ` +
      `output_tokens=${output} reasoning_output_tokens=${reasoning} total_tokens=${total} ` +
      `billing=${state.billing}\n`,
  );
}

function capturePromptInput({ args, outputPath, runId, usageDir, workdir }) {
  const traceHome = `${usageDir}/codex-prompt-input-home-${runId}`;
  mkdirSync(traceHome, { recursive: true });

  const tmpPath = `${outputPath}.tmp`;
  const errorPath = `${outputPath}.error.txt`;
  rmSync(tmpPath, { force: true });
  rmSync(errorPath, { force: true });
  writeFileSync(tmpPath, "");

  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const finish = (success) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(success);
    };
    const child = spawn("codex", args, {
      cwd: workdir,
      env: { ...process.env, CODEX_HOME: traceHome },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => appendFileSync(tmpPath, chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 12000) {
        stderr = stderr.slice(-12000);
      }
    });
    child.on("error", (error) => {
      rmSync(tmpPath, { force: true });
      writeFileSync(errorPath, `codex debug prompt-input failed to start: ${error.message}\n`);
      finish(false);
    });
    child.on("close", (code) => {
      if (code === 0) {
        renameSync(tmpPath, outputPath);
        finish(true);
        return;
      }
      rmSync(tmpPath, { force: true });
      writeFileSync(errorPath, stderr || `codex debug prompt-input exited with code ${code}\n`);
      finish(false);
    });
  });
}

function writeOneShotOutputSchema({ usageDir, runId }) {
  const path = `${usageDir}/codex-one-shot-output-schema-${runId}.json`;
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["status", "files", "tests_to_run", "assumptions", "needs_context"],
    properties: {
      status: { type: "string", enum: ["patch", "needs_context", "reject"] },
      files: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "mode", "original_hash", "content"],
          properties: {
            path: { type: "string" },
            mode: { type: "string", enum: ["replace", "new_file"] },
            original_hash: { type: "string" },
            content: { type: "string" },
          },
        },
      },
      tests_to_run: { type: "array", items: { type: "string" } },
      assumptions: { type: "array", items: { type: "string" } },
      needs_context: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["path", "symbol", "reason"],
          properties: {
            path: { type: "string" },
            symbol: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(schema, null, 2)}\n`);
  return path;
}

async function runCodex(promptArgs) {
  const usageDir = env.KLANI_USAGE_DIR || "/usage";
  const workdir = env.KLANI_WORKDIR || "/work";
  mkdirSync(usageDir, { recursive: true });
  mkdirSync(workdir, { recursive: true });

  const requestedMcpMode = env.KLANI_MCP_MODE || "";
  const initialMcpMode = normalizeMcpMode(requestedMcpMode);
  const runtimeProfile = normalizeRuntimeProfile(env.KLANI_CODEX_RUNTIME_PROFILE || "", initialMcpMode);
  const profileDefaults = runtimeProfileDefaults(runtimeProfile);
  const nativeDefault = runtimeProfile === "native_default";
  const mcpMode = requestedMcpMode ? initialMcpMode : profileDefaults.mcpMode;
  const enabledTools = parseCsv(env.KLANI_CODEX_ENABLED_TOOLS || "").length
    ? parseCsv(env.KLANI_CODEX_ENABLED_TOOLS || "")
    : profileDefaults.enabledTools;
  const profileArgs = codexProfileConfigArgs({
    runtimeProfile,
    shellTool: profileDefaults.shellTool,
  });
  const hub = mcpMode === "required"
    ? validateSingleLine("KLANI_HUB", env.KLANI_HUB || "127.0.0.1:8790", /^[A-Za-z0-9_.:-]+:[0-9]+$/)
    : "";
  const hubTokenEnv = normalizeHubTokenEnv(env.KLANI_HUB_TOKEN_ENV || "");
  const agentId = validateSingleLine("KLANI_AGENT_ID", env.KLANI_AGENT_ID || "gpt-5.5-xhigh-codex-subscription", /^[A-Za-z0-9._:-]+$/);
  const model = validateSingleLine("KLANI_MODEL", env.KLANI_MODEL || "gpt-5.5", /^[A-Za-z0-9._:-]+$/);
  const effort = validateSingleLine("KLANI_REASONING_EFFORT", env.KLANI_REASONING_EFFORT || "xhigh", /^(minimal|none|low|medium|high|xhigh)$/);
  const role = validateSingleLine("KLANI_ROLE", env.KLANI_ROLE || "worker", /^(planner|worker|reviewer)$/);
  const phase = validateSingleLine("KLANI_PHASE", env.KLANI_PHASE || role, /^[A-Za-z0-9._:-]+$/);
  const level = validateSingleLine("KLANI_LEVEL", env.KLANI_LEVEL || "2", /^[123]$/);
  const sandbox = validateSingleLine("KLANI_CODEX_SANDBOX", env.KLANI_CODEX_SANDBOX || "read-only", /^(read-only|workspace-write|danger-full-access)$/);
  const ticket = validateOptionalTicket(env.KLANI_TICKET || "");
  const billing = normalizeBilling(env.KLANI_BILLING || "");
  assertNoApiKeysForSubscription(billing, env);
  const capturePrompt = parseBooleanEnv(env.KLANI_CAPTURE_PROMPT_INPUT || "", false);
  const otelLivenessEnabled = parseBooleanEnv(env.KLANI_CODEX_OTEL_LIVENESS || "", true);

  const argPrompt = promptArgs.join(" ").trim();
  const envPrompt = (env.KLANI_PROMPT || "").trim();
  const stdinPrompt = !argPrompt && !envPrompt && env.KLANI_READ_STDIN === "1"
    ? await readStdin()
    : "";
  const defaultPrompt = mcpMode === "required"
    ? [
      "You are running inside the k-lani-coder Codex sandbox.",
      "Use the k-lani-coder MCP server for all project reads and writes.",
      "Do not inspect local files. This container intentionally has no repository checkout.",
      ticket
        ? `Work ticket ${ticket} as ${role}.`
        : "Ask the board for the next suitable ticket before doing implementation work.",
    ]
    : [
      "You are running inside the direct Codex benchmark container.",
      "Work only in the empty current project directory.",
      "Use the normal project files and shell gate in that directory.",
    ];
  const prompt = argPrompt || envPrompt || stdinPrompt || defaultPrompt.join("\n");

  const mcpConfig = mcpMode === "required"
    ? buildMcpConfig({ hub, agentId, level, ticket, workdir, hubTokenEnv, enabledTools })
    : "";

  const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const eventsPath = `${usageDir}/codex-events-${runId}.jsonl`;
  const promptInputPath = `${usageDir}/codex-prompt-input-${runId}.json`;
  const runStatePath = diagnosticPath(usageDir, "codex-run-state", runId, "ndjson");
  const stderrPath = diagnosticPath(usageDir, "codex-stderr", runId, "log");
  const oneShotResultPath = env.KLANI_CODEX_ONE_SHOT_RESULT_PATH || "";
  const oneShotOutputMode = normalizeOneShotOutputMode(env.KLANI_CODEX_ONE_SHOT_OUTPUT_MODE || "schema");
  const promptForCodex = buildOneShotPrompt({ prompt, oneShotResultPath, oneShotOutputMode });
  const outputSchemaPath = shouldUseOneShotOutputSchema(runtimeProfile, oneShotResultPath, oneShotOutputMode)
    ? writeOneShotOutputSchema({ usageDir, runId })
    : "";
  const summaryPath = usageFilePath();
  const proxyUrl = resolveCodexProxyUrl({
    explicitProxyUrl: env.KLANI_CODEX_PROXY_URL || "",
    proxyBaseUrl: env.KLANI_CODEX_PROXY_BASE_URL || "",
    ticket,
    role,
  });
  const providerArgs = buildProxyProviderArgs({ proxyUrl, agentId, billing });
  const state = {
    runId,
    threadId: "",
    ticket,
    role,
    phase,
    agentId,
    model,
    effort,
    runtimeProfile,
    oneShotOutputMode,
    billing,
    mcpMode,
    enabledTools,
    sandbox,
    proxyUrl,
    startedAt: new Date().toISOString(),
    startedAtMs: Date.now(),
    eventsPath,
    runStatePath,
    stderrPath,
    promptInputPath: capturePrompt ? promptInputPath : "",
    promptInputCapture: capturePrompt,
    contextPackPath: env.KLANI_CONTEXT_PACK_PATH || "",
    contextPackSha256: env.KLANI_CONTEXT_PACK_SHA256 || "",
    contextPackBytes: Number(env.KLANI_CONTEXT_PACK_BYTES || 0),
    contextPackEstimatedTokens: Number(env.KLANI_CONTEXT_PACK_ESTIMATED_TOKENS || 0),
    oneShotResultPath,
    codexHomeIsolated: parseBooleanEnv(env.KLANI_CODEX_HOME_ISOLATED || "", false),
    codexHomeMode: env.KLANI_CODEX_HOME_MODE || "",
    codexHomeLabel: env.KLANI_CODEX_HOME_LABEL || "",
    codexHomeManifestPath: env.KLANI_CODEX_HOME_MANIFEST_PATH || "",
    ephemeral: !nativeDefault,
    ignoreUserConfig: !nativeDefault,
    ignoreRules: !nativeDefault,
    projectDocMaxBytes: nativeDefault ? null : 0,
    turnCount: 0,
    mcpToolCalls: 0,
    commandExecutions: 0,
    webSearches: 0,
    agentMessages: 0,
    eventCount: 0,
    lastEventType: "",
    lastEventAtMs: 0,
    inTurn: false,
    turnStartedAtMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
    otelLivenessEnabled,
    otelLivenessEndpoint: "",
    otelRequests: 0,
    otelPayloadBytes: 0,
    otelEvents: 0,
    otelApiRequests: 0,
    otelSseEvents: 0,
    otelWebsocketEvents: 0,
    otelOutputTextDeltas: 0,
    otelResponseInProgress: 0,
    otelResponseCompleted: 0,
    otelParseErrors: 0,
    otelLastAtMs: 0,
    otelLastEventName: "",
    otelLastEventKind: "",
  };

  const otelLiveness = otelLivenessEnabled
    ? await startOtelLivenessServer(state)
    : null;
  state.otelLivenessEndpoint = otelLiveness ? otelLiveness.endpoint : "";
  const otelLivenessArgs = otelLiveness
    ? buildOtelLivenessArgs({ endpoint: otelLiveness.endpoint, agentId, ticket, role, phase, model, effort, billing })
    : [];

  const args = [
    "exec",
    "--json",
    ...(nativeDefault ? [] : ["--skip-git-repo-check", "--ephemeral", "--ignore-user-config", "--ignore-rules"]),
    "-C",
    workdir,
    "-m",
    model,
    "--sandbox",
    sandbox,
    "-c",
    "approval_policy=\"never\"",
    "-c",
    `model_reasoning_effort=${tomlString(effort)}`,
    "-c",
    "hide_agent_reasoning=true",
    ...otelLivenessArgs,
    ...profileArgs,
    ...providerArgs,
    ...mcpConfigArgs(mcpConfig),
    ...(outputSchemaPath ? ["--output-schema", outputSchemaPath] : []),
    ...(oneShotResultPath ? ["-o", oneShotResultPath] : []),
    "-",
  ];

  if (capturePrompt) {
    const promptInputArgs = buildPromptInputArgs({ model, effort, mcpConfig, providerArgs, profileArgs, prompt: promptForCodex });
    const captured = await capturePromptInput({
      args: promptInputArgs,
      outputPath: promptInputPath,
      runId,
      usageDir,
      workdir,
    });
    const trace = captured ? promptInputPath : `${promptInputPath}.error.txt`;
    process.stderr.write(`[k-lani-codex-agent] prompt input trace: ${trace}\n`);
  }

  process.stderr.write(
    `[k-lani-codex-agent] starting Codex model=${model} effort=${effort} agent=${agentId} ` +
      `ticket=${ticket || "-"} role=${role} phase=${phase} runtime_profile=${runtimeProfile} mcp=${mcpMode} ` +
      `one_shot_output_mode=${oneShotOutputMode} sandbox=${sandbox} hub=${hub || "-"} billing=${billing} proxy=${proxyUrl || "-"} ` +
      `otel_liveness=${otelLiveness ? "on" : "off"} usage=${summaryPath}\n`,
  );

  writeFileSync(eventsPath, "");
  writeFileSync(stderrPath, "");
  const noProgressTimeoutMs = noProgressTimeoutMsFromEnv(env);
  const silentTurnTimeoutMs = silentTurnTimeoutMsFromEnv(env);
  writeRunStateRecord(state, "start", {
    billing,
    sandbox,
    prompt_input_capture: capturePrompt,
    context_pack_path: state.contextPackPath || null,
    context_pack_sha256: state.contextPackSha256 || null,
    context_pack_bytes: state.contextPackBytes || 0,
    context_pack_estimated_tokens: state.contextPackEstimatedTokens || 0,
    one_shot_result_path: oneShotResultPath || null,
    one_shot_output_mode: oneShotOutputMode,
    output_schema_path: outputSchemaPath || null,
    no_progress_timeout_ms: noProgressTimeoutMs,
    silent_turn_timeout_ms: silentTurnTimeoutMs,
    otel_liveness_enabled: otelLivenessEnabled,
    otel_liveness_endpoint: state.otelLivenessEndpoint || null,
  });

  const child = spawn("codex", args, { cwd: workdir, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end(promptForCodex);

  const heartbeat = setInterval(() => {
    const now = Date.now();
    const timedOut = shouldAbortForNoProgress(state, now, noProgressTimeoutMs);
    const silentTurnTimedOut = shouldAbortForSilentTurn(state, now, silentTurnTimeoutMs);
    writeRunStateRecord(state, "heartbeat", {
      event_count: state.eventCount || 0,
      no_progress_timeout_ms: noProgressTimeoutMs,
      no_progress_timed_out: timedOut,
      silent_turn_timeout_ms: silentTurnTimeoutMs,
      silent_turn_timed_out: silentTurnTimedOut,
      in_turn: state.inTurn || false,
    });
    if ((timedOut || silentTurnTimedOut) && !state.noProgressTimedOut) {
      state.noProgressTimedOut = true;
      state.timeoutReason = silentTurnTimedOut ? "silent_turn_timeout" : "no_progress_timeout";
      process.stderr.write(
        silentTurnTimedOut
          ? `[k-lani-codex-agent] Codex turn stayed silent for ${silentTurnTimeoutMs}ms; terminating run ${runId}\n`
          : `[k-lani-codex-agent] no Codex progress for ${noProgressTimeoutMs}ms; terminating run ${runId}\n`,
      );
      writeRunStateRecord(state, state.timeoutReason, {
        no_progress_timeout_ms: noProgressTimeoutMs,
        silent_turn_timeout_ms: silentTurnTimeoutMs,
        event_count: state.eventCount || 0,
      });
      child.kill("SIGTERM");
      state.noProgressKillTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }, 5000);
      state.noProgressKillTimer.unref?.();
    }
  }, heartbeatMsFromEnv(env));
  heartbeat.unref?.();

  let pending = "";
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    appendFileSync(eventsPath, chunk);
    state.stdoutBytes += chunk.length;
    pending += chunk.toString("utf8");
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      parseCodexLine(line, state, summaryPath);
      newline = pending.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    appendFileSync(stderrPath, chunk);
    state.stderrBytes += chunk.length;
  });
  child.on("error", (error) => {
    clearInterval(heartbeat);
    closeOtelLivenessServer(otelLiveness);
    writeRunStateRecord(state, "exit", {
      exit_error: error.message,
      exit_code: null,
      signal: null,
    });
    fail(`codex failed to start: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    clearInterval(heartbeat);
    closeOtelLivenessServer(otelLiveness);
    if (state.noProgressKillTimer) {
      clearTimeout(state.noProgressKillTimer);
    }
    if (pending) {
      parseCodexLine(pending, state, summaryPath);
    }
    writeRunStateRecord(state, "exit", {
      exit_code: code ?? null,
      signal: signal || null,
      event_count: state.eventCount || 0,
      exit_reason: state.noProgressTimedOut ? (state.timeoutReason || "no_progress_timeout") : null,
    });
    if (state.noProgressTimedOut) {
      process.exit(124);
    }
    if (signal) {
      process.kill(process.pid, signal);
    }
    process.exit(code ?? 1);
  });
}

function main(argv) {
  const [mode = "run", ...args] = argv;

  if (mode === "help" || mode === "--help" || mode === "-h") {
    help();
  } else if (mode === "login") {
    spawnInherit("codex", ["login", "--device-auth"]);
  } else if (mode === "version") {
    spawnInherit("codex", ["--version"]);
  } else if (mode === "usage") {
    printUsageLog();
  } else if (mode === "run") {
    runCodex(args).catch((error) => fail(error.message));
  } else {
    runCodex([mode, ...args]).catch((error) => fail(error.message));
  }
}

export {
  assertNoApiKeysForSubscription,
  buildMcpConfig,
  buildOneShotPrompt,
  buildOtelLivenessArgs,
  buildPromptInputArgs,
  buildProxyProviderArgs,
  buildTicketProxyUrl,
  capturePromptInput,
  main,
  normalizeBilling,
  normalizeHubTokenEnv,
  normalizeMcpMode,
  normalizeOneShotOutputMode,
  normalizeRuntimeProfile,
  normalizeProxyUrl,
  noProgressTimeoutMsFromEnv,
  extractOtelLiveness,
  parseCodexLine,
  parseBooleanEnv,
  recordCodexEvent,
  runtimeProfileDefaults,
  codexProfileConfigArgs,
  proxyRole,
  resolveCodexProxyUrl,
  runManifestPath,
  shouldAbortForNoProgress,
  shouldAbortForSilentTurn,
  shouldUseOneShotOutputSchema,
  silentTurnTimeoutMsFromEnv,
  startOtelLivenessServer,
  tomlString,
  validateOptionalTicket,
  validateSingleLine,
  writeRunStateRecord,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
