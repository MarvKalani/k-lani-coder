# Direct Codex CLI benchmark image.
#
# Unlike codex-agent.Dockerfile, this image intentionally keeps a shell and a
# writable /work mount: Run A measures a broad direct agent in an empty project.
# Usage is still captured by the same k-lani wrapper via codex exec --json.
FROM debian:trixie-slim

ARG CODEX_NPM_VERSION=0.128.0

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates cargo git nodejs npm ripgrep rustc rustfmt \
    && npm install -g "@openai/codex@${CODEX_NPM_VERSION}" \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* /root/.npm \
    && groupadd --system --gid 10003 agent \
    && useradd --system --uid 10003 --gid 10003 --home-dir /home/agent \
        --create-home --shell /usr/sbin/nologin agent

COPY codex-mcp-agent.mjs /usr/local/bin/k-lani-codex-agent.mjs

RUN chmod 0755 /usr/local/bin/k-lani-codex-agent.mjs \
    && mkdir -p /home/agent/.codex /home/agent/.cache /work /usage \
    && chown -R agent:agent /home/agent /work /usage

USER agent
WORKDIR /work

ENV CODEX_HOME=/home/agent/.codex \
    KLANI_USAGE_DIR=/usage \
    KLANI_WORKDIR=/work \
    KLANI_MCP_MODE=none \
    KLANI_CODEX_SANDBOX=danger-full-access \
    KLANI_AGENT_ID=gpt-5.5-medium-codex-subscription \
    KLANI_MODEL=gpt-5.5 \
    KLANI_REASONING_EFFORT=medium \
    KLANI_ROLE=worker \
    KLANI_PHASE=direct_agent \
    KLANI_LEVEL=2

ENTRYPOINT ["node", "/usr/local/bin/k-lani-codex-agent.mjs"]
CMD ["run"]
