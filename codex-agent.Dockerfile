# Sandboxed Codex CLI agent image.
#
# This image contains the official Codex CLI plus the k-lani-coder MCP bridge,
# but no repository checkout. Codex can authenticate with its normal ChatGPT /
# Codex account flow, while project access is constrained to the MCP bridge.
#
# Build context is publish/k-lani-coder:
#   docker build -f codex-agent.Dockerfile \
#     -t k-lani-coder-codex-agent:2026.24.10 .
#
# The CLI version is pinned because Codex JSONL event shapes are part of the
# measurement contract we parse in codex-mcp-agent.mjs.
FROM debian:trixie-slim

ARG CODEX_NPM_VERSION=0.128.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates nodejs npm \
    && npm install -g "@openai/codex@${CODEX_NPM_VERSION}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && groupadd --system --gid 10003 agent \
    && useradd --system --uid 10003 --gid 10003 --home-dir /home/agent \
        --create-home --shell /usr/sbin/nologin agent

COPY bin/k-lani-coder /usr/local/bin/k-lani-coder
COPY codex-mcp-agent.mjs /usr/local/bin/k-lani-codex-agent.mjs

RUN chmod 0755 /usr/local/bin/k-lani-coder /usr/local/bin/k-lani-codex-agent.mjs \
    && mkdir -p /home/agent/.codex /home/agent/.cache /work /usage \
    && chown -R agent:agent /home/agent /work /usage

USER agent
WORKDIR /work

ENV CODEX_HOME=/home/agent/.codex \
    KLANI_USAGE_DIR=/usage \
    KLANI_HUB=127.0.0.1:8790 \
    KLANI_AGENT_ID=gpt-5.5-xhigh-codex-subscription \
    KLANI_MODEL=gpt-5.5 \
    KLANI_REASONING_EFFORT=xhigh \
    KLANI_ROLE=worker \
    KLANI_LEVEL=2

ENTRYPOINT ["node", "/usr/local/bin/k-lani-codex-agent.mjs"]
CMD ["run"]
