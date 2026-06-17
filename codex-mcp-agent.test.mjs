import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertNoApiKeysForSubscription,
  buildPromptInputArgs,
  buildOneShotPrompt,
  buildProxyProviderArgs,
  buildTicketProxyUrl,
  buildMcpConfig,
  buildOtelLivenessArgs,
  capturePromptInput,
  extractOtelLiveness,
  normalizeBilling,
  normalizeHubTokenEnv,
  normalizeMcpMode,
  normalizeOneShotOutputMode,
  normalizeRuntimeProfile,
  noProgressTimeoutMsFromEnv,
  parseCodexLine,
  parseBooleanEnv,
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
} from "./codex-mcp-agent.mjs";

test("subscription billing rejects Codex and OpenAI API key environment", () => {
  assert.throws(
    () => assertNoApiKeysForSubscription("subscription", { CODEX_API_KEY: "secret" }),
    /CODEX_API_KEY/,
  );
  assert.throws(
    () => assertNoApiKeysForSubscription("subscription", { OPENAI_API_KEY: "secret" }),
    /OPENAI_API_KEY/,
  );
  assert.doesNotThrow(() => assertNoApiKeysForSubscription("api", { OPENAI_API_KEY: "secret" }));
});

test("proxy provider keeps subscription billing on OpenAI auth", () => {
  const args = buildProxyProviderArgs({
    proxyUrl: "http://127.0.0.1:8789/t/abcdef12/worker/v1",
    agentId: "gpt-5.5-xhigh-codex-subscription",
    billing: "subscription",
  });

  assert.deepEqual(args.slice(0, 2), ["-c", 'model_provider="k_lani_proxy"']);
  const provider = args.join("\n");
  assert.match(provider, /model_providers\.k_lani_proxy=/);
  assert.match(provider, /base_url="http:\/\/127\.0\.0\.1:8789\/t\/abcdef12\/worker\/v1"/);
  assert.match(provider, /requires_openai_auth=true/);
  assert.match(provider, /"X-Agent-ID"="gpt-5\.5-xhigh-codex-subscription"/);
  assert.doesNotMatch(provider, /env_key/);
});

test("proxy provider uses explicit API-key billing when requested", () => {
  const args = buildProxyProviderArgs({
    proxyUrl: "http://127.0.0.1:8789/t/abcdef12/worker/v1",
    agentId: "gpt-5.5-medium-openai-api",
    billing: "api",
  });

  const provider = args.join("\n");
  assert.match(provider, /env_key="OPENAI_API_KEY"/);
  assert.doesNotMatch(provider, /requires_openai_auth=true/);
});

test("ticket proxy URL is derived from base URL, ticket, and role", () => {
  assert.equal(proxyRole("planner"), "planner");
  assert.equal(proxyRole("worker"), "worker");
  assert.equal(proxyRole("reviewer"), "review");
  assert.equal(
    buildTicketProxyUrl({
      proxyBaseUrl: "http://127.0.0.1:8080",
      ticket: "AbCdEf12",
      role: "reviewer",
    }),
    "http://127.0.0.1:8080/t/abcdef12/review/v1",
  );
  assert.equal(
    buildTicketProxyUrl({
      proxyBaseUrl: "http://127.0.0.1:8080/v1",
      ticket: "abcdef12",
      role: "worker",
    }),
    "http://127.0.0.1:8080/t/abcdef12/worker/v1",
  );
});

test("explicit proxy URL wins over derived ticket proxy URL", () => {
  assert.equal(
    resolveCodexProxyUrl({
      explicitProxyUrl: "http://127.0.0.1:9999/t/11111111/worker/v1",
      proxyBaseUrl: "http://127.0.0.1:8080",
      ticket: "abcdef12",
      role: "planner",
    }),
    "http://127.0.0.1:9999/t/11111111/worker/v1",
  );
  assert.equal(
    resolveCodexProxyUrl({
      explicitProxyUrl: "",
      proxyBaseUrl: "http://127.0.0.1:8080",
      ticket: "",
      role: "worker",
    }),
    "",
  );
});

test("prompt-input trace args mirror the model, effort, provider, and MCP config", () => {
  const args = buildPromptInputArgs({
    model: "gpt-5.5",
    effort: "xhigh",
    mcpConfig: '{command="k-lani-coder"}',
    providerArgs: ["-c", 'model_provider="k_lani_proxy"'],
    profileArgs: ["-c", 'web_search="disabled"'],
    prompt: "Use only the board.",
  });

  assert.deepEqual(args.slice(0, 2), ["debug", "prompt-input"]);
  assert.deepEqual(args.slice(2, 4), ["-c", 'model="gpt-5.5"']);
  assert.deepEqual(args.slice(4, 6), ["-c", 'model_reasoning_effort="xhigh"']);
  assert.ok(args.includes('web_search="disabled"'));
  assert.ok(args.includes('model_provider="k_lani_proxy"'));
  assert.ok(args.includes('mcp_servers.k_lani_coder={command="k-lani-coder"}'));
  assert.equal(args.at(-1), "Use only the board.");
  assert.equal(args.includes("-"), false);
});

test("prompt-input trace can run in direct mode without an MCP server", () => {
  const args = buildPromptInputArgs({
    model: "gpt-5.5",
    effort: "medium",
    mcpConfig: "",
    providerArgs: [],
    prompt: "Build the app in the empty workspace.",
  });

  assert.deepEqual(args.slice(0, 2), ["debug", "prompt-input"]);
  assert.equal(args.includes("mcp_servers.k_lani_coder="), false);
  assert.equal(args.at(-1), "Build the app in the empty workspace.");
});

test("OTEL liveness args disable prompt logging and route to the local sink", () => {
  const args = buildOtelLivenessArgs({
    endpoint: "http://127.0.0.1:43199/v1/logs",
    agentId: "gpt-5.5-medium-codex-subscription",
    ticket: "abcdef12",
    role: "worker",
    phase: "repair",
    model: "gpt-5.5",
    effort: "medium",
    billing: "subscription",
  });

  const joined = args.join("\n");
  assert.match(joined, /otel\.environment="k-lani"/);
  assert.match(joined, /otel\.log_user_prompt=false/);
  assert.match(joined, /endpoint="http:\/\/127\.0\.0\.1:43199\/v1\/logs"/);
  assert.match(joined, /protocol="json"/);
  assert.match(joined, /"x-k-lani-ticket"="abcdef12"/);
  assert.match(joined, /"x-k-lani-role"="worker"/);
  assert.doesNotMatch(joined, /log_user_prompt=true/);
});

test("OTEL liveness extraction keeps only counters, not payload text", () => {
  const secretPayload = "DO_NOT_STORE_PROMPT_OR_RESPONSE";
  const otlp = {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.api_request" } },
                  { key: "body", value: { stringValue: secretPayload } },
                ],
              },
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.sse_event" } },
                  { key: "event.kind", value: { stringValue: "response.output_text.delta" } },
                  { key: "delta", value: { stringValue: secretPayload } },
                ],
              },
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.sse_event" } },
                  { key: "event.kind", value: { stringValue: "response.completed" } },
                ],
              },
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.websocket_event" } },
                  { key: "event.kind", value: { stringValue: "response.in_progress" } },
                ],
              },
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "codex.websocket_event" } },
                  { key: "event.kind", value: { stringValue: "response.output_text.delta" } },
                  { key: "delta", value: { stringValue: secretPayload } },
                ],
              },
              {
                attributes: [
                  { key: "event.name", value: { stringValue: "unrelated.event" } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const stats = extractOtelLiveness(JSON.stringify(otlp));
  assert.equal(stats.events, 5);
  assert.equal(stats.apiRequests, 1);
  assert.equal(stats.sseEvents, 2);
  assert.equal(stats.websocketEvents, 2);
  assert.equal(stats.responseInProgress, 1);
  assert.equal(stats.outputTextDeltas, 2);
  assert.equal(stats.responseCompleted, 1);
  assert.equal(stats.lastEventName, "codex.websocket_event");
  assert.equal(stats.lastEventKind, "response.output_text.delta");
  assert.equal(JSON.stringify(stats).includes(secretPayload), false);
});

test("OTEL liveness server writes counters without raw payloads", async () => {
  const root = mkdtempSync(join(tmpdir(), "k-lani-codex-otel-test-"));
  const runStatePath = join(root, "codex-run-state-test.ndjson");
  const secretPayload = "DO_NOT_PERSIST_THIS_OTEL_BODY";
  const state = {
    runId: "run-otel",
    ticket: "abcdef12",
    role: "worker",
    phase: "implementation",
    agentId: "gpt-5.5-medium-codex-subscription",
    model: "gpt-5.5",
    effort: "medium",
    runtimeProfile: "codex_one_shot_minimal",
    mcpMode: "none",
    enabledTools: [],
    startedAtMs: Date.now(),
    runStatePath,
    eventsPath: "/usage/events.jsonl",
    stderrPath: "/usage/stderr.log",
    otelLivenessEnabled: true,
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
  const otel = await startOtelLivenessServer(state);
  state.otelLivenessEndpoint = otel.endpoint;
  try {
    await postJson(otel.endpoint, {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  attributes: [
                    { key: "event.name", value: { stringValue: "codex.sse_event" } },
                    { key: "event.kind", value: { stringValue: "response.completed" } },
                    { key: "body", value: { stringValue: secretPayload } },
                  ],
                },
                {
                  attributes: [
                    { key: "event.name", value: { stringValue: "codex.websocket_event" } },
                    { key: "event.kind", value: { stringValue: "response.output_text.delta" } },
                    { key: "delta", value: { stringValue: secretPayload } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const text = readFileSync(runStatePath, "utf8");
    const row = JSON.parse(text.trim());
    assert.equal(row.kind, "otel_liveness");
    assert.equal(row.otel_batch_events, 2);
    assert.equal(row.otel_batch_sse_events, 1);
    assert.equal(row.otel_batch_websocket_events, 1);
    assert.equal(row.otel_batch_output_text_deltas, 1);
    assert.equal(row.otel_batch_response_completed, 1);
    assert.equal(row.otel_events, 2);
    assert.equal(row.otel_sse_events, 1);
    assert.equal(row.otel_websocket_events, 1);
    assert.equal(row.otel_output_text_deltas, 1);
    assert.equal(row.otel_response_completed, 1);
    assert.ok(row.otel_request_bytes > 0);
    assert.equal(text.includes(secretPayload), false);
  } finally {
    otel.server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP bridge config approves guarded k-lani-coder tool calls", () => {
  const config = buildMcpConfig({
    hub: "127.0.0.1:8790",
    agentId: "gpt-5.5-medium-codex-subscription",
    level: "2",
    ticket: "0c01f400",
    workdir: "/work",
    hubTokenEnv: "K_LANI_CODER_HUB_TOKEN",
    enabledTools: ["ticket", "file", "write"],
  });

  assert.ok(config.includes('command="/usr/local/bin/k-lani-coder"'));
  assert.ok(config.includes('"--connect"'));
  assert.ok(config.includes('"0c01f400"'));
  assert.ok(config.includes('"--hub-token-env"'));
  assert.ok(config.includes('"K_LANI_CODER_HUB_TOKEN"'));
  assert.ok(config.includes("required=true"));
  assert.ok(config.includes('default_tools_approval_mode="approve"'));
  assert.ok(config.includes('enabled_tools=["ticket","file","write"]'));
});

test("MCP bridge config omits ticket argument when no ticket is scoped", () => {
  const config = buildMcpConfig({
    hub: "127.0.0.1:8790",
    agentId: "gpt-5.5-medium-codex-subscription",
    level: "2",
    ticket: "",
    workdir: "/work",
  });

  assert.equal(config.includes('"--ticket"'), false);
  assert.ok(config.includes('default_tools_approval_mode="approve"'));
});

test("billing and boolean environment parsing stay explicit", () => {
  assert.equal(normalizeBilling(""), "subscription");
  assert.equal(normalizeBilling("subscription"), "subscription");
  assert.equal(normalizeBilling("api"), "api");
  assert.throws(() => normalizeBilling("flat"), /KLANI_BILLING/);
  assert.equal(normalizeMcpMode(""), "required");
  assert.equal(normalizeMcpMode("none"), "none");
  assert.throws(() => normalizeMcpMode("optional"), /KLANI_MCP_MODE/);
  assert.equal(normalizeRuntimeProfile("", "required"), "codex_mcp_full_legacy");
  assert.equal(normalizeRuntimeProfile("", "none"), "codex_one_shot_with_gate");
  assert.equal(normalizeRuntimeProfile("native_default", "none"), "native_default");
  assert.equal(normalizeRuntimeProfile("codex_one_shot_minimal", "none"), "codex_one_shot_minimal");
  assert.throws(() => normalizeRuntimeProfile("everything", "required"), /KLANI_CODEX_RUNTIME_PROFILE/);
  assert.equal(runtimeProfileDefaults("native_default").mcpMode, "none");
  assert.deepEqual(codexProfileConfigArgs({
    runtimeProfile: "native_default",
    shellTool: true,
  }), []);
  assert.equal(runtimeProfileDefaults("codex_mcp_limited").mcpMode, "required");
  assert.deepEqual(runtimeProfileDefaults("codex_mcp_limited").enabledTools, [
    "ticket",
    "overview",
    "search",
    "context",
    "file",
    "write",
    "check",
  ]);
  assert.ok(codexProfileConfigArgs({
    runtimeProfile: "codex_one_shot_minimal",
    shellTool: false,
  }).includes("features.shell_tool=false"));
  assert.equal(normalizeHubTokenEnv(""), "");
  assert.equal(normalizeHubTokenEnv("K_LANI_CODER_HUB_TOKEN"), "K_LANI_CODER_HUB_TOKEN");
  assert.throws(() => normalizeHubTokenEnv("k_lani_secret"), /KLANI_HUB_TOKEN_ENV/);

  assert.equal(parseBooleanEnv("", true), true);
  assert.equal(parseBooleanEnv("0", true), false);
  assert.equal(parseBooleanEnv("false", true), false);
  assert.equal(parseBooleanEnv("1", false), true);
  assert.throws(() => parseBooleanEnv("maybe", true), /boolean/);
});

test("Codex no-progress timeout is configurable and can be disabled", () => {
  assert.equal(noProgressTimeoutMsFromEnv({}), 180000);
  assert.equal(noProgressTimeoutMsFromEnv({ KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS: "60000" }), 60000);
  assert.equal(noProgressTimeoutMsFromEnv({ KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS: "0" }), 0);
  assert.equal(noProgressTimeoutMsFromEnv({ KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS: "5" }), 180000);
  assert.equal(noProgressTimeoutMsFromEnv({ KLANI_AGENT_NO_PROGRESS_TIMEOUT_MS: "nope" }), 180000);

  assert.equal(silentTurnTimeoutMsFromEnv({}), 0);
  assert.equal(silentTurnTimeoutMsFromEnv({ KLANI_AGENT_SILENT_TURN_TIMEOUT_MS: "600000" }), 600000);
  assert.equal(silentTurnTimeoutMsFromEnv({ KLANI_AGENT_SILENT_TURN_TIMEOUT_MS: "0" }), 0);
  assert.equal(silentTurnTimeoutMsFromEnv({ KLANI_AGENT_SILENT_TURN_TIMEOUT_MS: "5" }), 0);
  assert.equal(silentTurnTimeoutMsFromEnv({ KLANI_AGENT_SILENT_TURN_TIMEOUT_MS: "nope" }), 0);
});

test("Codex no-progress timeout uses the newest visible or OTEL liveness timestamp", () => {
  const state = {
    startedAtMs: 1_000,
    lastEventAtMs: 10_000,
    otelLastAtMs: 0,
    inTurn: false,
  };

  assert.equal(shouldAbortForNoProgress(state, 29_999, 20_000), false);
  assert.equal(shouldAbortForNoProgress(state, 30_000, 20_000), true);
  assert.equal(shouldAbortForNoProgress(state, 120_000, 0), false);

  state.inTurn = true;
  assert.equal(shouldAbortForNoProgress(state, 1_000_000, 20_000), true);
  state.otelLastAtMs = 990_001;
  assert.equal(shouldAbortForNoProgress(state, 1_000_000, 20_000), false);
  assert.equal(shouldAbortForNoProgress(state, 1_010_001, 20_000), true);
});

test("Codex silent-turn timeout resets on visible or OTEL liveness", () => {
  const state = {
    inTurn: true,
    turnStartedAtMs: 10_000,
    lastEventAtMs: 10_000,
    otelLastAtMs: 0,
  };

  assert.equal(shouldAbortForSilentTurn(state, 69_999, 60_000), false);
  assert.equal(shouldAbortForSilentTurn(state, 70_000, 60_000), true);
  state.otelLastAtMs = 65_000;
  assert.equal(shouldAbortForSilentTurn(state, 70_000, 60_000), false);
  assert.equal(shouldAbortForSilentTurn(state, 125_000, 60_000), true);
  assert.equal(shouldAbortForSilentTurn(state, 1_000_000, 0), false);
  assert.equal(shouldAbortForSilentTurn({ ...state, inTurn: false }, 1_000_000, 60_000), false);
  assert.equal(shouldAbortForSilentTurn({ inTurn: true, turnStartedAtMs: 0 }, 1_000_000, 60_000), false);
});

test("one-shot patch schema is enabled only for host-applied patch runs", () => {
  assert.equal(normalizeOneShotOutputMode(""), "schema");
  assert.equal(normalizeOneShotOutputMode("framed_json"), "framed_json");
  assert.throws(() => normalizeOneShotOutputMode("markdown"), /schema or framed_json/);
  assert.equal(shouldUseOneShotOutputSchema("codex_one_shot_minimal", "/usage/result.json"), true);
  assert.equal(shouldUseOneShotOutputSchema("codex_one_shot_with_gate", "/usage/result.json"), true);
  assert.equal(shouldUseOneShotOutputSchema("codex_one_shot_with_gate", "/usage/result.json", "framed_json"), false);
  assert.equal(shouldUseOneShotOutputSchema("codex_one_shot_with_gate", ""), false);
  assert.equal(shouldUseOneShotOutputSchema("codex_mcp_limited", "/usage/result.json"), false);
});

test("framed one-shot output mode appends the result frame instruction once", () => {
  const prompt = "Work the ticket.";
  const framed = buildOneShotPrompt({
    prompt,
    oneShotResultPath: "/usage/result.json",
    oneShotOutputMode: "framed_json",
  });

  assert.match(framed, /KLANI_ONE_SHOT_RESULT_BEGIN/);
  assert.match(framed, /KLANI_ONE_SHOT_RESULT_END/);
  assert.equal(
    buildOneShotPrompt({
      prompt: framed,
      oneShotResultPath: "/usage/result.json",
      oneShotOutputMode: "framed_json",
    }),
    framed,
  );
  assert.equal(
    buildOneShotPrompt({
      prompt,
      oneShotResultPath: "/usage/result.json",
      oneShotOutputMode: "schema",
    }),
    prompt,
  );
});

test("codex exec json usage row is an exact ticket role run manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "k-lani-codex-usage-test-"));
  const usageDir = join(root, "usage");
  mkdirForTest(usageDir);
  const usagePath = join(usageDir, "codex-usage.ndjson");
  const runStatePath = join(usageDir, "codex-run-state-test.ndjson");
  const stderrPath = join(usageDir, "codex-stderr-test.log");
  const state = {
    runId: "run-1",
    threadId: "",
    ticket: "abcdef12",
    role: "worker",
    phase: "implementation",
    agentId: "gpt-5.5-medium-codex-subscription",
    model: "gpt-5.5",
    effort: "medium",
    billing: "subscription",
    proxyUrl: "",
    startedAt: "2026-06-15T10:00:00.000Z",
    startedAtMs: Date.parse("2026-06-15T10:00:00.000Z"),
    eventsPath: "/usage/codex-events-run-1.jsonl",
    runStatePath,
    stderrPath,
    promptInputPath: "/usage/codex-prompt-input-run-1.json",
    promptInputCapture: true,
    runtimeProfile: "codex_mcp_limited",
    mcpMode: "required",
    enabledTools: ["ticket", "file"],
    contextPackPath: "/usage/context.md",
    contextPackSha256: "a".repeat(64),
    contextPackBytes: 1234,
    contextPackEstimatedTokens: 309,
    codexHomeIsolated: true,
    codexHomeMode: "auth-only-fresh",
    codexHomeLabel: "native-new-program",
    codexHomeManifestPath: "/usage/codex-home-manifest.txt",
    turnCount: 0,
    mcpToolCalls: 0,
    commandExecutions: 0,
    webSearches: 0,
    agentMessages: 0,
    eventCount: 0,
    lastEventType: "",
    lastEventAtMs: 0,
    stdoutBytes: 42,
    stderrBytes: 7,
  };

  try {
    parseCodexLine(
      JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
      state,
      usagePath,
    );
    parseCodexLine(JSON.stringify({ type: "turn.started" }), state, usagePath);
    parseCodexLine(
      JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call", tool: "file" } }),
      state,
      usagePath,
    );
    parseCodexLine(
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
      state,
      usagePath,
    );
    parseCodexLine(
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 100,
          cached_input_tokens: 80,
          output_tokens: 7,
          reasoning_output_tokens: 3,
          total_tokens: 107,
        },
      }),
      state,
      usagePath,
    );

    const usage = JSON.parse(readFileSync(usagePath, "utf8").trim());
    assert.equal(usage.source, "codex_exec_json");
    assert.equal(usage.attribution, "exact");
    assert.equal(usage.ticket, "abcdef12");
    assert.equal(usage.role, "worker");
    assert.equal(usage.phase, "implementation");
    assert.equal(usage.thread_id, "thread-1");
    assert.equal(usage.total_tokens, 107);
    assert.equal(usage.runtime_profile, "codex_mcp_limited");
    assert.equal(usage.mcp_mode, "required");
    assert.deepEqual(usage.enabled_tools, ["ticket", "file"]);
    assert.equal(usage.turn_count, 1);
    assert.equal(usage.mcp_tool_calls, 1);
    assert.equal(usage.agent_messages, 1);
    assert.equal(usage.context_pack_sha256, "a".repeat(64));
    assert.equal(usage.context_pack_estimated_tokens, 309);
    assert.equal(usage.codex_home_isolated, true);
    assert.equal(usage.codex_home_mode, "auth-only-fresh");
    assert.equal(usage.codex_home_label, "native-new-program");
    assert.equal(usage.codex_home_manifest_path, "/usage/codex-home-manifest.txt");
    assert.equal(usage.prompt_input_capture, true);
    assert.equal(usage.session_mode, "fresh");
    assert.equal(usage.ephemeral, true);
    assert.equal(usage.resume, false);
    assert.equal(usage.run_state_path, runStatePath);
    assert.equal(usage.stderr_path, stderrPath);
    assert.equal(usage.last_event_type, "turn.completed");

    const runStateRows = readFileSync(runStatePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(
      runStateRows.map((row) => row.event_type),
      ["thread.started", "turn.started", "item.completed", "item.completed", "turn.completed"],
    );
    assert.equal(runStateRows[2].item_type, "mcp_tool_call");
    assert.equal(runStateRows[3].item_type, "agent_message");
    assert.equal(runStateRows[3].text_preview, "ok");
    assert.equal(runStateRows.at(-1).stdout_bytes, 42);
    assert.equal(runStateRows.at(-1).stderr_bytes, 7);

    const manifest = JSON.parse(readFileSync(runManifestPath(usagePath), "utf8").trim());
    assert.equal(manifest.source, "subscription_run_manifest");
    assert.equal(manifest.manifest_kind, "subscription_role_run");
    assert.equal(manifest.manifest_version, 1);
    assert.equal(manifest.attribution, "exact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt-input trace writes stdout to the requested artifact path", async () => {
  const root = mkdtempSync(join(tmpdir(), "k-lani-codex-trace-test-"));
  const bin = join(root, "bin");
  const usageDir = join(root, "usage");
  const workdir = join(root, "work");
  const outputPath = join(usageDir, "codex-prompt-input-test.json");
  mkdirForTest(bin);
  mkdirForTest(usageDir);
  mkdirForTest(workdir);

  const codexPath = join(bin, "codex");
  writeFileSync(
    codexPath,
    [
      "#!/usr/bin/env node",
      "process.stdout.write(JSON.stringify([{ type: 'message', role: 'user' }]));",
      "",
    ].join("\n"),
  );
  chmodSync(codexPath, 0o755);

  const oldPath = process.env.PATH || "";
  process.env.PATH = `${bin}:${oldPath}`;
  try {
    const ok = await capturePromptInput({
      args: ["debug", "prompt-input", "hello"],
      outputPath,
      runId: "test",
      usageDir,
      workdir,
    });
    assert.equal(ok, true);
    assert.equal(existsSync(outputPath), true);
    assert.match(readFileSync(outputPath, "utf8"), /"role":"user"/);
  } finally {
    process.env.PATH = oldPath;
    rmSync(root, { recursive: true, force: true });
  }
});

function mkdirForTest(path) {
  mkdirSync(path, { recursive: true });
}

function postJson(endpoint, payload) {
  const url = new URL(endpoint);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: url.hostname,
      port: Number(url.port),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      res.resume();
      res.on("end", () => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`unexpected status ${res.statusCode}`));
        }
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}
