# k-lani-ai-proxy — key custody and token ledger

The proxy sits between your agent runtime and any OpenAI-compatible
API. It exists for two reasons:

1. **Key custody.** The agent process never sees your API key. The
   runtime talks to `http://127.0.0.1:8080/v1/...` with a dummy key;
   the proxy injects the real one server-side. Protected literals
   are masked in every log and trace — keys cannot leak through the
   dashboard or the ledger.
2. **The token ledger.** Every upstream call is recorded with prompt,
   completion, and total tokens plus cost. This is the evidence half
   of the model report card: what a task really cost, per model,
   without trusting anyone's marketing numbers.

## Configuration (environment variables)

| Variable | Meaning | Default |
|---|---|---|
| `MKLANI_UPSTREAM_URL` | upstream chat-completions endpoint | `http://api.openai.com/v1/chat/completions` |
| `MKLANI_UPSTREAM_API_KEY` | the real key, injected server-side | — |
| `MKLANI_PROXY_BIND` | listen address | `0.0.0.0:8080` (use `127.0.0.1:8080`!) |
| `MKLANI_DATA_DIR` | ledger + trace storage | `/data` |
| `MKLANI_MODELS_FILE` | model registry with per-deployment `pricing` (see below) | — (built-in demo rates) |

## Recipes

**OpenAI** (the default upstream — only the key is needed):

```bash
MKLANI_UPSTREAM_API_KEY=sk-... \
MKLANI_PROXY_BIND=127.0.0.1:8080 \
MKLANI_DATA_DIR=./data/proxy \
k-lani-ai-proxy
```

**Local llama-server / LM Studio** (no key, full offline):

```bash
MKLANI_UPSTREAM_URL=http://127.0.0.1:8001/v1/chat/completions \
MKLANI_PROXY_BIND=127.0.0.1:8080 \
MKLANI_DATA_DIR=./data/proxy \
k-lani-ai-proxy
```

**Any other OpenAI-compatible provider**: set `MKLANI_UPSTREAM_URL`
to its chat-completions endpoint and provide the key. Your agent
config never changes — it always points at the proxy.

**Anthropic / Claude Code** (T-55): the proxy relays the Anthropic
Messages protocol and meters BOTH usage dialects exactly — including
streaming, where Anthropic splits the counts across `message_start`
(input) and `message_delta` (cumulative output). Route a Claude Code
session through the proxy and it lands in the same token/cost ledger
as every other model:

```bash
MKLANI_UPSTREAM_URL=https://api.anthropic.com/v1/messages \
MKLANI_AUTH_PASSTHROUGH=1 \
MKLANI_PROXY_BIND=127.0.0.1:8080 \
MKLANI_DATA_DIR=./data/proxy \
k-lani-ai-proxy

ANTHROPIC_BASE_URL=http://127.0.0.1:8080 claude
```

With `MKLANI_AUTH_PASSTHROUGH=1` the proxy is a transparent observer:
Claude Code's own credentials flow through untouched (still masked
from all logs and traces), the proxy adds the measurement.

Point your agent runtime at the proxy, e.g. in `opencode.json`:

```json
"provider": { "via-proxy": {
  "npm": "@ai-sdk/openai-compatible",
  "options": { "baseURL": "http://127.0.0.1:8080/v1",
                "apiKey": "sk-local-dummy" },
  "models": { "your-model-id": { "tools": true } } } }
```

## Per-ticket cost attribution (board cards with prices)

Sessions launched for a board ticket point their base URL at the
**routing prefix** `/t/<ticket-id8>/<role>/` (role: `planner`,
`worker`, or `review`):

```
http://127.0.0.1:8080/t/7aed3684/worker/v1
```

The proxy strips the prefix before relaying and stamps
`ticket=7aed3684 role=worker` into every ledger line. The live board
(`k-lani-coder board-web --proxy-log <file>`) then shows per ticket
what each phase really cost — measured, not estimated. Untagged
traffic keeps working unchanged.

**Real prices instead of demo rates:** add a `pricing` object to a
deployment in your `k-lani-coder-models.json` and point
`MKLANI_MODELS_FILE` at it. Values are currency units per million
tokens; an explicit zero marks a local model as free:

```json
"gpt-5.5": { "pricing": { "input_per_mtok": 1.25,
              "output_per_mtok": 10.0, "currency": "USD" } },
"gemma4-12b-qat-mtp": { "pricing": { "input_per_mtok": 0,
              "output_per_mtok": 0, "currency": "USD" } }
```

`cost_micros` in the ledger is then exact: `tokens × per_mtok`.

## Security posture

- Keys never appear in logs, traces, or the dashboard (masked by the
  protected-literals filter; empirically verified).
- Request **payloads are visible** in the dashboard — that is your
  source code. Bind to loopback only; never expose the dashboard
  port. See `SECURITY.md`.
- The ledger is append-only; `report --proxy-log` (k-lani-coder)
  folds it into the model report card.
