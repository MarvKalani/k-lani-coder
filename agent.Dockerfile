# Sandboxed MCP-only agent image.
#
# The agent that runs here has ZERO of the repo: no workspace is ever
# mounted into this container. Its ONLY way to read or change code is the
# k-lani-coder MCP server (a `serve --connect` bridge into the hub). So:
#   - reads are symbol-slices, not whole files (the token-saving premise),
#   - writes go through guarded write/replace -> WORM diff evidence,
#   - the "model keeps reading files" leak is closed by construction, not
#     by asking it nicely.
#
# Build context is publish/k-lani-coder (so `bin/k-lani-coder` resolves):
#   docker build -f publish/k-lani-coder/agent.Dockerfile \
#     -t k-lani-coder-agent:2026.24.10 publish/k-lani-coder
#
# trixie matches the glibc the release binaries were built against.
FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10002 agent \
    && useradd --system --uid 10002 --gid 10002 --home-dir /home/agent \
        --create-home --shell /usr/sbin/nologin agent

# The bridge binary ONLY. No workspace, no toolchain, nothing of the repo:
# the hub (a different container) owns the workspace and runs the gate.
COPY bin/k-lani-coder /usr/local/bin/k-lani-coder

USER agent
WORKDIR /home/agent

# Identity MUST be the exact model + effort (e.g. opus-4-8-high), never a
# role nickname. The default hub binds loopback, so this container reaches it
# on the host's 127.0.0.1 via `network_mode: host`. For private-network mode,
# run the hub with an env-sourced token and pass the same token into this
# container (see docker-compose.agent.yml / AGENT_SANDBOX.md). Host networking
# does NOT grant filesystem access: the repo is still absent because nothing
# is mounted.
ENV KLANI_HUB=127.0.0.1:8790 \
    KLANI_AGENT_ID=sandbox-agent \
    KLANI_LEVEL=2

# Default = the MCP-only bridge into the hub. Your agent CLI (Claude Code
# / Codex) drops in on top and configures THIS as its only MCP server,
# with its own native Read/Bash/Edit/Write tools DENIED (see
# AGENT_SANDBOX.md) — belt and suspenders over the empty filesystem.
ENTRYPOINT ["k-lani-coder"]
CMD ["serve", "--connect", "127.0.0.1:8790", "--agent-id", "sandbox-agent", "--level", "2"]
