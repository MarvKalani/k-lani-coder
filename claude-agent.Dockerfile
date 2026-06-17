# Sandboxed Claude Code agent image.
#
# This image contains the official Claude Code CLI plus the k-lani-coder MCP
# bridge, but no repository checkout. Claude authenticates with its normal
# subscription flow, while project access is constrained to the MCP bridge.
#
# Build context is publish/k-lani-coder:
#   docker build -f claude-agent.Dockerfile \
#     -t k-lani-coder-claude-agent:2026.24.10 .
#
# The CLI version is pinned because the stream-json event shape is part of the
# measurement contract parsed in claude-mcp-agent.mjs.
FROM debian:trixie-slim

ARG CLAUDE_CODE_NPM_VERSION=2.1.177

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates nodejs npm \
    && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_NPM_VERSION}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && groupadd --system --gid 10004 agent \
    && useradd --system --uid 10004 --gid 10004 --home-dir /home/agent \
        --create-home --shell /usr/sbin/nologin agent

COPY bin/k-lani-coder /usr/local/bin/k-lani-coder
COPY claude-mcp-agent.mjs /usr/local/bin/k-lani-claude-agent.mjs

RUN chmod 0755 /usr/local/bin/k-lani-coder /usr/local/bin/k-lani-claude-agent.mjs \
    && mkdir -p /home/agent/.claude /home/agent/.cache /work /usage \
    && chown -R agent:agent /home/agent /work /usage \
    # Native shell execution is not part of this harness. Claude Code still
    # runs and can spawn the MCP bridge directly, but generated shell commands
    # fail even if a future permission configuration regresses.
    && rm -f /bin/sh /usr/bin/sh /bin/bash /usr/bin/bash || true

USER agent
WORKDIR /work

ENV HOME=/home/agent \
    KLANI_USAGE_DIR=/usage \
    KLANI_HUB=127.0.0.1:8790 \
    KLANI_AGENT_ID=opus-4-8-medium-claude-code-subscription \
    KLANI_MODEL=claude-opus-4-8 \
    KLANI_REASONING_EFFORT=medium \
    KLANI_ROLE=worker \
    KLANI_LEVEL=2

ENTRYPOINT ["node", "/usr/local/bin/k-lani-claude-agent.mjs"]
CMD ["run"]
