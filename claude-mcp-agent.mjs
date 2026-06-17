#!/usr/bin/env node
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import process from "node:process";

const env = process.env;
const CLAUDE_ONE_SHOT_MINIMAL = "claude_one_shot_minimal";
const CLAUDE_MCP_FULL_LEGACY = "claude_mcp_full_legacy";
const ONE_SHOT_RESULT_BEGIN = "KLANI_ONE_SHOT_RESULT_BEGIN";
const ONE_SHOT_RESULT_END = "KLANI_ONE_SHOT_RESULT_END";

function fail(message) {
  process.stderr.write(`[k-lani-claude-agent] ${message}\n`);
  process.exit(2);
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

function normalizeClaudeRuntimeProfile(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return CLAUDE_MCP_FULL_LEGACY;
  }
  if (raw === CLAUDE_ONE_SHOT_MINIMAL || raw === CLAUDE_MCP_FULL_LEGACY || raw === "claude-code") {
    return raw;
  }
  throw new Error(`unknown Claude runtime profile: ${raw}`);
}

function isClaudeOneShotProfile(runtimeProfile) {
  return runtimeProfile === CLAUDE_ONE_SHOT_MINIMAL;
}

function assertNoApiKeysForSubscription(billing, sourceEnv) {
  if (billing !== "subscription") {
    return;
  }
  const keys = ["ANTHROPIC_API_KEY"].filter((name) => {
    const value = sourceEnv[name];
    return value !== undefined && String(value).trim() !== "";
  });
  if (keys.length) {
    throw new Error(
      `KLANI_BILLING=subscription refuses API key environment (${keys.join(", ")}). ` +
        "Remove these variables to stay on Claude subscription auth.",
    );
  }
}

function usageFilePath() {
  return `${env.KLANI_USAGE_DIR || "/usage"}/claude-usage.ndjson`;
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

function writeRunStateRecord(state, kind, extra = {}) {
  if (!state.runStatePath) {
    return;
  }
  const record = {
    source: "claude_stream_json",
    kind,
    ts: new Date().toISOString(),
    run_id: state.runId,
    session_id: state.sessionId || null,
    ticket: state.ticket || null,
    role: state.role,
    phase: state.phase,
    agent: state.agentId,
    model: state.model,
    effort: state.effort,
    runtime_profile: state.runtimeProfile,
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
    stdout_bytes: state.stdoutBytes || 0,
    stderr_bytes: state.stderrBytes || 0,
    events_path: state.eventsPath || null,
    stderr_path: state.stderrPath || null,
    ...extra,
  };
  appendFileSync(state.runStatePath, `${JSON.stringify(record)}\n`);
}

function recordClaudeEvent(event, state) {
  if (!event || !event.type) {
    return;
  }
  state.lastEventType = event.type;
  state.lastEventAtMs = Date.now();
  state.eventCount = (state.eventCount || 0) + 1;

  const usage = event.message && event.message.usage
    ? readUsage(event.message.usage)
    : (event.usage ? readUsage(event.usage) : null);
  writeRunStateRecord(state, "event", {
    event_type: event.type,
    event_count: state.eventCount,
    has_usage: usage ? totalUsageTokens(usage) > 0 : false,
    usage_total_tokens: usage ? totalUsageTokens(usage) : 0,
    message_id: event.message && event.message.id ? event.message.id : null,
    subtype: event.subtype || null,
    result_type: event.result_type || null,
    text_preview: previewText(extractClaudeText(event)),
    error: event.error ? previewText(event.error) : null,
  });
}

function heartbeatMsFromEnv(sourceEnv = env) {
  const value = Number(sourceEnv.KLANI_AGENT_HEARTBEAT_MS || 15000);
  return Number.isFinite(value) && value >= 1000 ? value : 15000;
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

function emptyUsage() {
  return {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
}

function numberField(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function readUsage(raw) {
  const usage = raw || {};
  return {
    input_tokens: numberField(usage.input_tokens),
    cache_creation_input_tokens: numberField(
      usage.cache_creation_input_tokens || usage.cache_creation_tokens,
    ),
    cache_read_input_tokens: numberField(
      usage.cache_read_input_tokens || usage.cache_read_tokens,
    ),
    output_tokens: numberField(usage.output_tokens),
  };
}

function addUsage(target, usage) {
  target.input_tokens += usage.input_tokens;
  target.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  target.cache_read_input_tokens += usage.cache_read_input_tokens;
  target.output_tokens += usage.output_tokens;
}

function totalUsageTokens(usage) {
  return (
    usage.input_tokens +
    usage.cache_creation_input_tokens +
    usage.cache_read_input_tokens +
    usage.output_tokens
  );
}

function usageForRecord(state) {
  if (state.resultUsage && totalUsageTokens(state.resultUsage) > 0) {
    return state.resultUsage;
  }
  if (state.assistantUsage && totalUsageTokens(state.assistantUsage) > 0) {
    return state.assistantUsage;
  }
  return null;
}

function buildMcpConfig({ hub, agentId, level, ticket, workdir, hubTokenEnv = "" }) {
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
  return {
    mcpServers: {
      k_lani_coder: {
        command: "/usr/local/bin/k-lani-coder",
        args: bridgeArgs,
        cwd: workdir,
      },
    },
  };
}

function allowedMcpTools() {
  return [
    "mcp__k_lani_coder__overview",
    "mcp__k_lani_coder__search",
    "mcp__k_lani_coder__symbol",
    "mcp__k_lani_coder__context",
    "mcp__k_lani_coder__write",
    "mcp__k_lani_coder__replace",
    "mcp__k_lani_coder__check",
    "mcp__k_lani_coder__ticket",
    "mcp__k_lani_coder__case",
  ];
}

function buildClaudeArgs({ model, effort, mcpConfigPath = "", prompt, runtimeProfile = CLAUDE_MCP_FULL_LEGACY }) {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    model,
    "--effort",
    effort,
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
    "--no-chrome",
    "--prompt-suggestions",
    "false",
  ];
  if (!isClaudeOneShotProfile(runtimeProfile)) {
    args.push(
      "--mcp-config",
      mcpConfigPath,
      "--strict-mcp-config",
      "--allowedTools",
      allowedMcpTools().join(","),
    );
  }
  args.push(prompt);
  return args;
}

function extractClaudeText(event) {
  if (event.type === "assistant" && event.message) {
    const content = event.message.content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((part) => part && part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");
    }
  }
  if (event.type === "result" && typeof event.result === "string") {
    return event.result;
  }
  return "";
}

function extractFramedOneShotResult(text) {
  const start = text.indexOf(ONE_SHOT_RESULT_BEGIN);
  if (start === -1) {
    throw new Error(`Claude one-shot output is missing ${ONE_SHOT_RESULT_BEGIN}`);
  }
  const afterStart = start + ONE_SHOT_RESULT_BEGIN.length;
  const rest = text.slice(afterStart);
  const end = rest.indexOf(ONE_SHOT_RESULT_END);
  if (end === -1) {
    throw new Error(`Claude one-shot output is missing ${ONE_SHOT_RESULT_END}`);
  }
  const jsonText = rest.slice(0, end).trim();
  const value = JSON.parse(jsonText);
  return `${JSON.stringify(value, null, 2)}\n`;
}

function accumulateClaudeUsage(line, state) {
  if (!line.trim()) {
    return;
  }
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.session_id) {
    state.sessionId = event.session_id;
  }
  recordClaudeEvent(event, state);

  if (state.outputText !== undefined) {
    const text = extractClaudeText(event);
    if (text) {
      state.outputText += `${text}\n`;
    }
  }

  if (event.type === "assistant" && event.message && event.message.usage) {
    const messageId = event.message.id || event.message_id || "";
    if (messageId && state.seenAssistantIds.has(messageId)) {
      return;
    }
    if (messageId) {
      state.seenAssistantIds.add(messageId);
    }
    if (state.agentMessages !== undefined) {
      state.agentMessages += 1;
    }
    addUsage(state.assistantUsage, readUsage(event.message.usage));
    return;
  }

  if (event.type !== "result") {
    return;
  }
  if (event.usage) {
    state.resultUsage = readUsage(event.usage);
  }
  if (event.total_cost_usd !== undefined && event.total_cost_usd !== null) {
    const cost = Number(event.total_cost_usd);
    if (Number.isFinite(cost)) {
      state.totalCostUsd = cost;
    }
  }
  if (event.modelUsage) {
    state.modelUsage = event.modelUsage;
  } else if (event.model_usage) {
    state.modelUsage = event.model_usage;
  }
}

function writeUsageRecord(state, usageSummaryPath) {
  const usage = usageForRecord(state);
  if (!usage) {
    return;
  }
  const costMicros = state.billing === "api" && state.totalCostUsd !== null
    ? Math.round(state.totalCostUsd * 1_000_000)
    : null;
  const record = {
    source: "claude_stream_json",
    billing: state.billing,
    ts: new Date().toISOString(),
    run_id: state.runId,
    session_id: state.sessionId || null,
    ticket: state.ticket || null,
    role: state.role,
    phase: state.phase,
    agent: state.agentId,
    model: state.model,
    effort: state.effort,
    events_path: state.eventsPath,
    run_state_path: state.runStatePath || null,
    stderr_path: state.stderrPath || null,
    last_event_type: state.lastEventType || null,
    ms_since_last_event: state.lastEventAtMs ? Date.now() - state.lastEventAtMs : null,
    prompt_path: state.promptPath,
    mcp_config_path: state.mcpConfigPath,
    runtime_profile: state.runtimeProfile,
    mcp_mode: state.mcpMode,
    enabled_tools: state.enabledTools,
    turn_count: state.turnCount,
    mcp_tool_calls: state.mcpToolCalls,
    command_executions: state.commandExecutions,
    web_searches: state.webSearches,
    agent_messages: state.agentMessages,
    context_pack_path: state.contextPackPath,
    context_pack_sha256: state.contextPackSha256,
    context_pack_bytes: state.contextPackBytes,
    context_pack_estimated_tokens: state.contextPackEstimatedTokens,
    prompt_input_capture: false,
    ephemeral: true,
    resume: false,
    ignore_user_config: false,
    ignore_rules: false,
    project_doc_max_bytes: 0,
    input_tokens: usage.input_tokens,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: totalUsageTokens(usage),
    estimated_cost_usd: state.totalCostUsd,
    model_usage: state.modelUsage || null,
    cost_micros: costMicros,
  };
  appendFileSync(usageSummaryPath, `${JSON.stringify(record)}\n`);
  process.stderr.write(
    `[k-lani-claude-usage] agent=${state.agentId} model=${state.model} effort=${state.effort} ` +
      `ticket=${state.ticket || "-"} input_tokens=${usage.input_tokens} ` +
      `cache_creation_input_tokens=${usage.cache_creation_input_tokens} ` +
      `cache_read_input_tokens=${usage.cache_read_input_tokens} output_tokens=${usage.output_tokens} ` +
      `total_tokens=${totalUsageTokens(usage)} billing=${state.billing}\n`,
  );
}

function writeOneShotResult(state) {
  if (!state.oneShotResultPath) {
    throw new Error("KLANI_CLAUDE_ONE_SHOT_RESULT_PATH is required for claude_one_shot_minimal");
  }
  const result = extractFramedOneShotResult(state.outputText || "");
  writeFileSync(state.oneShotResultPath, result);
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

function help() {
  process.stdout.write(`Usage:
  claude-agent login
      Run 'claude auth login --claudeai' inside the container.

  claude-agent setup-token
      Run 'claude setup-token' inside the container.

  claude-agent auth-status
      Run 'claude auth status --text' inside the container.

  claude-agent run [prompt...]
      Run Claude Code non-interactively with k-lani-coder as the only MCP
      server. If no prompt argument is supplied, KLANI_PROMPT is used. Set
      KLANI_READ_STDIN=1 to read the prompt from stdin.

  claude-agent usage
      Print /usage/claude-usage.ndjson.

Important environment:
  KLANI_HUB                 default 127.0.0.1:8790
  KLANI_HUB_TOKEN_ENV       optional env-var name read by the Rust bridge
  KLANI_AGENT_ID            exact model deployment identity
  KLANI_MODEL               default claude-opus-4-8
  KLANI_REASONING_EFFORT    low|medium|high|xhigh|max, default medium
  KLANI_TICKET              optional 8-hex board ticket id
  KLANI_ROLE                planner|worker|reviewer
  KLANI_PHASE               measured phase label, default same as role
  KLANI_LEVEL               1|2|3
  KLANI_RUNTIME_PROFILE     claude_one_shot_minimal for no-MCP context-pack mode
  KLANI_MCP_MODE            none|required; one-shot forces none
  KLANI_BILLING             subscription|api, default subscription
  KLANI_PROMPT              prompt for run mode
  KLANI_READ_STDIN          set to 1 to read prompt from stdin

Subscription billing refuses ANTHROPIC_API_KEY. Claude Code auth is stored in
the container's /home/agent volume.
`);
}

async function runClaude(promptArgs) {
  const usageDir = env.KLANI_USAGE_DIR || "/usage";
  const workdir = env.KLANI_WORKDIR || "/work";
  mkdirSync(usageDir, { recursive: true });
  mkdirSync(workdir, { recursive: true });

  const hub = validateSingleLine("KLANI_HUB", env.KLANI_HUB || "127.0.0.1:8790", /^[A-Za-z0-9_.:-]+:[0-9]+$/);
  const hubTokenEnv = normalizeHubTokenEnv(env.KLANI_HUB_TOKEN_ENV || "");
  const agentId = validateSingleLine("KLANI_AGENT_ID", env.KLANI_AGENT_ID || "opus-4-8-medium-claude-code-subscription", /^[A-Za-z0-9._:-]+$/);
  const model = validateSingleLine("KLANI_MODEL", env.KLANI_MODEL || "claude-opus-4-8", /^[A-Za-z0-9._:-]+$/);
  const effort = validateSingleLine("KLANI_REASONING_EFFORT", env.KLANI_REASONING_EFFORT || "medium", /^(low|medium|high|xhigh|max)$/);
  const role = validateSingleLine("KLANI_ROLE", env.KLANI_ROLE || "worker", /^(planner|worker|reviewer)$/);
  const phase = validateSingleLine("KLANI_PHASE", env.KLANI_PHASE || role, /^[A-Za-z0-9_.:-]+$/);
  const level = validateSingleLine("KLANI_LEVEL", env.KLANI_LEVEL || "2", /^[123]$/);
  const ticket = validateOptionalTicket(env.KLANI_TICKET || "");
  const billing = normalizeBilling(env.KLANI_BILLING || "");
  const runtimeProfile = normalizeClaudeRuntimeProfile(
    env.KLANI_CLAUDE_RUNTIME_PROFILE || env.KLANI_RUNTIME_PROFILE || "",
  );
  const mcpMode = isClaudeOneShotProfile(runtimeProfile)
    ? "none"
    : String(env.KLANI_MCP_MODE || "required").trim() || "required";
  if (isClaudeOneShotProfile(runtimeProfile) && mcpMode !== "none") {
    throw new Error("claude_one_shot_minimal requires KLANI_MCP_MODE=none");
  }
  if (!isClaudeOneShotProfile(runtimeProfile) && mcpMode !== "required") {
    throw new Error("Claude MCP runtime profiles require KLANI_MCP_MODE=required");
  }
  assertNoApiKeysForSubscription(billing, env);

  const argPrompt = promptArgs.join(" ").trim();
  const envPrompt = (env.KLANI_PROMPT || "").trim();
  const stdinPrompt = !argPrompt && !envPrompt && env.KLANI_READ_STDIN === "1"
    ? await readStdin()
    : "";
  const prompt =
    argPrompt ||
    envPrompt ||
    stdinPrompt ||
    [
      "You are running inside the k-lani-coder Claude Code sandbox.",
      "Use the k-lani-coder MCP server for all project reads and writes.",
      "Do not inspect local files. This container intentionally has no repository checkout.",
      ticket
        ? `Work ticket ${ticket} as ${role}.`
        : "Ask the board for the next suitable ticket before doing implementation work.",
    ].join("\n");

  const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const eventsPath = `${usageDir}/claude-events-${runId}.jsonl`;
  const runStatePath = diagnosticPath(usageDir, "claude-run-state", runId, "ndjson");
  const stderrPath = diagnosticPath(usageDir, "claude-stderr", runId, "log");
  const promptPath = `${usageDir}/claude-prompt-${runId}.json`;
  const mcpConfigPath = `${usageDir}/claude-mcp-${runId}.json`;
  const summaryPath = usageFilePath();
  const oneShotResultPath = env.KLANI_CLAUDE_ONE_SHOT_RESULT_PATH || "";
  let mcpConfig = null;
  if (mcpMode !== "none") {
    mcpConfig = buildMcpConfig({ hub, agentId, level, ticket, workdir, hubTokenEnv });
    writeFileSync(mcpConfigPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
  }
  const args = buildClaudeArgs({ model, effort, mcpConfigPath, prompt, runtimeProfile });
  writeFileSync(
    promptPath,
    `${JSON.stringify({
      prompt,
      model,
      effort,
      agent: agentId,
      role,
      phase,
      ticket: ticket || null,
      runtime_profile: runtimeProfile,
      mcp_mode: mcpMode,
      args: args.slice(0, -1),
      mcp_config_path: mcpConfig ? mcpConfigPath : null,
      one_shot_result_path: oneShotResultPath || null,
      context_pack_path: env.KLANI_CONTEXT_PACK_PATH || "",
      context_pack_sha256: env.KLANI_CONTEXT_PACK_SHA256 || "",
      context_pack_bytes: Number(env.KLANI_CONTEXT_PACK_BYTES || 0),
      context_pack_estimated_tokens: Number(env.KLANI_CONTEXT_PACK_ESTIMATED_TOKENS || 0),
    }, null, 2)}\n`,
  );

  const state = {
    runId,
    sessionId: "",
    ticket,
    role,
    phase,
    agentId,
    model,
    effort,
    billing,
    startedAtMs: Date.now(),
    runtimeProfile,
    mcpMode,
    enabledTools: mcpMode === "none" ? "" : allowedMcpTools().join(","),
    turnCount: 0,
    mcpToolCalls: 0,
    commandExecutions: 0,
    webSearches: 0,
    agentMessages: 0,
    contextPackPath: env.KLANI_CONTEXT_PACK_PATH || "",
    contextPackSha256: env.KLANI_CONTEXT_PACK_SHA256 || "",
    contextPackBytes: Number(env.KLANI_CONTEXT_PACK_BYTES || 0),
    contextPackEstimatedTokens: Number(env.KLANI_CONTEXT_PACK_ESTIMATED_TOKENS || 0),
    oneShotResultPath,
    outputText: "",
    eventsPath,
    runStatePath,
    stderrPath,
    promptPath,
    mcpConfigPath: mcpConfig ? mcpConfigPath : null,
    seenAssistantIds: new Set(),
    assistantUsage: emptyUsage(),
    resultUsage: null,
    totalCostUsd: null,
    modelUsage: null,
    eventCount: 0,
    lastEventType: "",
    lastEventAtMs: 0,
    stdoutBytes: 0,
    stderrBytes: 0,
  };

  process.stderr.write(
    `[k-lani-claude-agent] starting Claude Code model=${model} effort=${effort} ` +
      `agent=${agentId} ticket=${ticket || "-"} runtime_profile=${runtimeProfile} ` +
      `mcp_mode=${mcpMode} hub=${hub} billing=${billing} usage=${summaryPath}\n`,
  );

  writeFileSync(eventsPath, "");
  writeFileSync(stderrPath, "");
  writeRunStateRecord(state, "start", {
    billing,
    prompt_path: promptPath,
    mcp_config_path: mcpConfig ? mcpConfigPath : null,
    context_pack_path: state.contextPackPath || null,
    context_pack_sha256: state.contextPackSha256 || null,
    context_pack_bytes: state.contextPackBytes || 0,
    context_pack_estimated_tokens: state.contextPackEstimatedTokens || 0,
    one_shot_result_path: oneShotResultPath || null,
  });

  const heartbeat = setInterval(() => {
    writeRunStateRecord(state, "heartbeat", {
      event_count: state.eventCount || 0,
    });
  }, heartbeatMsFromEnv(env));
  heartbeat.unref?.();

  const child = spawn("claude", args, { cwd: workdir, stdio: ["ignore", "pipe", "pipe"] });
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
      accumulateClaudeUsage(line, state);
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
    writeRunStateRecord(state, "exit", {
      exit_error: error.message,
      exit_code: null,
      signal: null,
    });
    fail(`claude failed to start: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    clearInterval(heartbeat);
    if (pending) {
      accumulateClaudeUsage(pending, state);
    }
    let exitCode = code ?? 1;
    if (exitCode === 0 && isClaudeOneShotProfile(runtimeProfile)) {
      try {
        writeOneShotResult(state);
      } catch (error) {
        process.stderr.write(`[k-lani-claude-agent] ${error.message}\n`);
        exitCode = 2;
      }
    }
    writeUsageRecord(state, summaryPath);
    writeRunStateRecord(state, "exit", {
      exit_code: exitCode,
      signal: signal || null,
      event_count: state.eventCount || 0,
    });
    if (signal) {
      process.kill(process.pid, signal);
    }
    process.exit(exitCode);
  });
}

function main(argv) {
  const [mode = "run", ...args] = argv;

  if (mode === "help" || mode === "--help" || mode === "-h") {
    help();
  } else if (mode === "login") {
    spawnInherit("claude", ["auth", "login", "--claudeai"]);
  } else if (mode === "setup-token") {
    spawnInherit("claude", ["setup-token"]);
  } else if (mode === "auth-status") {
    spawnInherit("claude", ["auth", "status", "--text"]);
  } else if (mode === "version") {
    spawnInherit("claude", ["--version"]);
  } else if (mode === "usage") {
    printUsageLog();
  } else if (mode === "run") {
    runClaude(args).catch((error) => fail(error.message));
  } else {
    runClaude([mode, ...args]).catch((error) => fail(error.message));
  }
}

export {
  accumulateClaudeUsage,
  allowedMcpTools,
  assertNoApiKeysForSubscription,
  buildClaudeArgs,
  buildMcpConfig,
  emptyUsage,
  extractFramedOneShotResult,
  main,
  normalizeBilling,
  normalizeClaudeRuntimeProfile,
  normalizeHubTokenEnv,
  parseBooleanEnv,
  readUsage,
  recordClaudeEvent,
  totalUsageTokens,
  usageForRecord,
  validateOptionalTicket,
  validateSingleLine,
  writeRunStateRecord,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
