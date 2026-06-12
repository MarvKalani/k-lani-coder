# Binary-only k-lani-coder demo image (harness + metering proxy).
#
# Build from publish/k-lani-coder after `bash build.sh` filled bin/:
#   docker build -t k-lani-coder:2026.24.2 .
#
# Base is the Rust toolchain image ON PURPOSE: the harness's write gate
# runs `cargo check`/`cargo test` and rustfmt INSIDE this container
# when you mount your workspace — the toolchain IS the safety layer.

# trixie: the release binaries are built on a glibc-2.39 host, so the
# runtime base must be at least as new (bookworm's 2.36 is too old)
FROM rust:1-slim-trixie

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && rustup component add rustfmt \
    && groupadd --system --gid 10001 k-lani \
    && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent \
        --shell /usr/sbin/nologin k-lani \
    && mkdir -p /data /work \
    && chown -R 10001:10001 /data /work

COPY bin/k-lani-coder bin/k-lani-ai-proxy /usr/local/bin/

ENV MKLANI_DATA_DIR=/data \
    MKLANI_PROXY_BIND=0.0.0.0:8080 \
    MKLANI_SEMANTIC_CACHE=0

USER k-lani
VOLUME /data
EXPOSE 8080

ENTRYPOINT ["tini", "--"]
# default service: the metering proxy. The harness itself is launched
# by your agent frontend over stdio (see README Docker section).
CMD ["k-lani-ai-proxy"]
