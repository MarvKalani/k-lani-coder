import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  accumulateClaudeUsage,
  allowedMcpTools,
  assertNoApiKeysForSubscription,
  buildClaudeArgs,
  buildMcpConfig,
  extractFramedOneShotResult,
  normalizeBilling,
  normalizeClaudeRuntimeProfile,
  normalizeHubTokenEnv,
  parseBooleanEnv,
  usageForRecord,
} from "./claude-mcp-agent.mjs";

test("subscription billing rejects Anthropic API key environment", () => {
  assert.throws(
    () => assertNoApiKeysForSubscription("subscription", { ANTHROPIC_API_KEY: "secret" }),
    /ANTHROPIC_API_KEY/,
  );
  assert.doesNotThrow(() => assertNoApiKeysForSubscription("api", { ANTHROPIC_API_KEY: "secret" }));
});

test("MCP config scopes Claude Code to the k-lani-coder bridge", () => {
  const config = buildMcpConfig({
    hub: "127.0.0.1:8790",
    agentId: "opus-4-8-medium-claude-code-subscription",
    level: "2",
    ticket: "0c044f5a",
    workdir: "/work",
    hubTokenEnv: "K_LANI_CODER_HUB_TOKEN",
  });

  assert.deepEqual(Object.keys(config.mcpServers), ["k_lani_coder"]);
  const server = config.mcpServers.k_lani_coder;
  assert.equal(server.command, "/usr/local/bin/k-lani-coder");
  assert.deepEqual(server.args.slice(0, 5), ["serve", "--connect", "127.0.0.1:8790", "--agent-id", "opus-4-8-medium-claude-code-subscription"]);
  assert.ok(server.args.includes("--ticket"));
  assert.ok(server.args.includes("0c044f5a"));
  assert.ok(server.args.includes("--hub-token-env"));
  assert.ok(server.args.includes("K_LANI_CODER_HUB_TOKEN"));
  assert.equal(server.cwd, "/work");
});

test("MCP config omits ticket argument when no ticket is scoped", () => {
  const config = buildMcpConfig({
    hub: "127.0.0.1:8790",
    agentId: "opus-4-8-medium-claude-code-subscription",
    level: "2",
    ticket: "",
    workdir: "/work",
  });

  assert.equal(config.mcpServers.k_lani_coder.args.includes("--ticket"), false);
});

test("Claude args select Opus 4.8 medium and disable native tools", () => {
  const args = buildClaudeArgs({
    model: "claude-opus-4-8",
    effort: "medium",
    mcpConfigPath: "/usage/claude-mcp-test.json",
    prompt: "Work from the board.",
  });

  assert.ok(args.includes("-p"));
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "claude-opus-4-8"]);
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), ["--effort", "medium"]);
  assert.deepEqual(args.slice(args.indexOf("--output-format"), args.indexOf("--output-format") + 2), ["--output-format", "stream-json"]);
  assert.ok(args.includes("--strict-mcp-config"));
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "dontAsk"]);
  assert.deepEqual(args.slice(args.indexOf("--allowedTools"), args.indexOf("--allowedTools") + 2), [
    "--allowedTools",
    allowedMcpTools().join(","),
  ]);
  assert.ok(allowedMcpTools().includes("mcp__k_lani_coder__ticket"));
  assert.ok(allowedMcpTools().includes("mcp__k_lani_coder__replace"));
  assert.equal(args.at(-1), "Work from the board.");
});

test("Claude one-shot args disable MCP and native tools", () => {
  const args = buildClaudeArgs({
    model: "claude-opus-4-8",
    effort: "medium",
    runtimeProfile: "claude_one_shot_minimal",
    prompt: "Use the context pack.",
  });

  assert.ok(args.includes("-p"));
  assert.equal(args.includes("--mcp-config"), false);
  assert.equal(args.includes("--strict-mcp-config"), false);
  assert.equal(args.includes("--allowedTools"), false);
  assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), ["--permission-mode", "dontAsk"]);
  assert.equal(args.at(-1), "Use the context pack.");
});

test("Claude one-shot framed result is extracted as canonical JSON", () => {
  const result = extractFramedOneShotResult([
    "some explanation before the frame",
    "KLANI_ONE_SHOT_RESULT_BEGIN",
    "{\"status\":\"patch\",\"files\":[],\"tests_to_run\":[],\"assumptions\":[],\"needs_context\":[]}",
    "KLANI_ONE_SHOT_RESULT_END",
    "ignored tail",
  ].join("\n"));

  assert.equal(
    result,
    "{\n  \"status\": \"patch\",\n  \"files\": [],\n  \"tests_to_run\": [],\n  \"assumptions\": [],\n  \"needs_context\": []\n}\n",
  );
  assert.throws(() => extractFramedOneShotResult("{}"), /KLANI_ONE_SHOT_RESULT_BEGIN/);
  assert.throws(
    () => extractFramedOneShotResult("KLANI_ONE_SHOT_RESULT_BEGIN\n{}\n"),
    /KLANI_ONE_SHOT_RESULT_END/,
  );
});

test("Claude usage prefers final result totals and keeps per-step fallback", () => {
  const state = { seenAssistantIds: new Set(), assistantUsage: emptyUsage(), resultUsage: null, totalCostUsd: null };

  accumulateClaudeUsage(
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 40,
        },
      },
    }),
    state,
  );
  accumulateClaudeUsage(
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 20,
          cache_read_input_tokens: 30,
          output_tokens: 40,
        },
      },
    }),
    state,
  );
  accumulateClaudeUsage(
    JSON.stringify({
      type: "result",
      total_cost_usd: 0.00125,
      usage: {
        input_tokens: 200,
        cache_creation_input_tokens: 25,
        cache_read_input_tokens: 60,
        output_tokens: 70,
      },
    }),
    state,
  );

  assert.deepEqual(state.assistantUsage, {
    input_tokens: 100,
    cache_creation_input_tokens: 20,
    cache_read_input_tokens: 30,
    output_tokens: 40,
  });
  assert.deepEqual(state.resultUsage, {
    input_tokens: 200,
    cache_creation_input_tokens: 25,
    cache_read_input_tokens: 60,
    output_tokens: 70,
  });
  assert.equal(state.totalCostUsd, 0.00125);
});

test("Claude run state records progress events before final usage", () => {
  const root = mkdtempSync(join(tmpdir(), "k-lani-claude-state-test-"));
  const usageDir = join(root, "usage");
  mkdirSync(usageDir, { recursive: true });
  const runStatePath = join(usageDir, "claude-run-state-test.ndjson");
  const state = {
    runId: "run-1",
    sessionId: "",
    ticket: "abcdef12",
    role: "worker",
    phase: "repair",
    agentId: "opus-4-8-medium-claude-code-subscription",
    model: "claude-opus-4-8",
    effort: "medium",
    billing: "subscription",
    runtimeProfile: "claude_one_shot_minimal",
    mcpMode: "none",
    enabledTools: "",
    turnCount: 0,
    mcpToolCalls: 0,
    commandExecutions: 0,
    webSearches: 0,
    agentMessages: 0,
    startedAtMs: Date.parse("2026-06-15T10:00:00.000Z"),
    eventsPath: "/usage/claude-events-run-1.jsonl",
    runStatePath,
    stderrPath: "/usage/claude-stderr-run-1.log",
    stdoutBytes: 123,
    stderrBytes: 4,
    eventCount: 0,
    lastEventType: "",
    lastEventAtMs: 0,
    outputText: "",
    seenAssistantIds: new Set(),
    assistantUsage: emptyUsage(),
    resultUsage: null,
    totalCostUsd: null,
  };

  try {
    accumulateClaudeUsage(
      JSON.stringify({
        type: "system",
        session_id: "session-1",
      }),
      state,
    );
    accumulateClaudeUsage(
      JSON.stringify({
        type: "assistant",
        session_id: "session-1",
        message: {
          id: "msg_1",
          content: [{ type: "text", text: "I am preparing the patch." }],
          usage: {
            input_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 5,
            output_tokens: 3,
          },
        },
      }),
      state,
    );
    accumulateClaudeUsage(
      JSON.stringify({
        type: "result",
        session_id: "session-1",
        result: "done",
        usage: {
          input_tokens: 11,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 5,
          output_tokens: 4,
        },
      }),
      state,
    );

    const rows = readFileSync(runStatePath, "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(rows.map((row) => row.event_type), ["system", "assistant", "result"]);
    assert.equal(rows[1].text_preview, "I am preparing the patch.");
    assert.equal(rows[1].has_usage, true);
    assert.equal(rows[1].usage_total_tokens, 18);
    assert.equal(rows[2].usage_total_tokens, 20);
    assert.equal(rows[2].stdout_bytes, 123);
    assert.equal(rows[2].stderr_bytes, 4);
    assert.equal(state.sessionId, "session-1");
    assert.equal(state.lastEventType, "result");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude usage falls back to assistant totals when final result usage is empty", () => {
  const state = { seenAssistantIds: new Set(), assistantUsage: emptyUsage(), resultUsage: null, totalCostUsd: null };

  accumulateClaudeUsage(
    JSON.stringify({
      type: "assistant",
      message: {
        id: "msg_1",
        usage: {
          input_tokens: 2,
          cache_creation_input_tokens: 10852,
          cache_read_input_tokens: 0,
          output_tokens: 16686,
        },
      },
    }),
    state,
  );
  accumulateClaudeUsage(
    JSON.stringify({
      type: "result",
      total_cost_usd: 0.532942,
      usage: {
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      },
    }),
    state,
  );

  assert.deepEqual(usageForRecord(state), {
    input_tokens: 2,
    cache_creation_input_tokens: 10852,
    cache_read_input_tokens: 0,
    output_tokens: 16686,
  });
  assert.equal(state.totalCostUsd, 0.532942);
});

test("billing and boolean environment parsing stay explicit", () => {
  assert.equal(normalizeBilling(""), "subscription");
  assert.equal(normalizeBilling("subscription"), "subscription");
  assert.equal(normalizeBilling("api"), "api");
  assert.throws(() => normalizeBilling("flat"), /KLANI_BILLING/);
  assert.equal(normalizeClaudeRuntimeProfile(""), "claude_mcp_full_legacy");
  assert.equal(normalizeClaudeRuntimeProfile("claude-code"), "claude-code");
  assert.equal(normalizeClaudeRuntimeProfile("claude_one_shot_minimal"), "claude_one_shot_minimal");
  assert.throws(() => normalizeClaudeRuntimeProfile("codex_one_shot_minimal"), /unknown Claude runtime profile/);
  assert.equal(normalizeHubTokenEnv(""), "");
  assert.equal(normalizeHubTokenEnv("K_LANI_CODER_HUB_TOKEN"), "K_LANI_CODER_HUB_TOKEN");
  assert.throws(() => normalizeHubTokenEnv("k_lani_secret"), /KLANI_HUB_TOKEN_ENV/);

  assert.equal(parseBooleanEnv("", true), true);
  assert.equal(parseBooleanEnv("0", true), false);
  assert.equal(parseBooleanEnv("false", true), false);
  assert.equal(parseBooleanEnv("1", false), true);
  assert.throws(() => parseBooleanEnv("maybe", true), /boolean/);
});

function emptyUsage() {
  return {
    input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0,
  };
}
