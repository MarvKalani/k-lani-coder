# Security Policy -- k-lani

## Supported Versions

k-lani is in active development (pre-1.0). Security fixes are
applied to the latest `main` branch. Tagged releases receive patches for
90 days after the next minor version is released.

| Version  | Supported          |
| -------- | ------------------ |
| `main`   | :white_check_mark: |
| `0.1.x`  | :white_check_mark: |
| `< 0.1`  | :x:                |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

Report security issues privately via one of:

- **Email:** security@kalanis.de (preferred)
- **GitHub Private Vulnerability Reporting:** Security tab → "Report a vulnerability"

Include, if possible:

- A description of the issue and its impact.
- Steps to reproduce (minimal `.rs` test case preferred).
- Affected version or commit SHA.
- Any suggested fix or mitigation.

## Disclosure Process

1. **Acknowledgement** within **5 business days** of receipt.
2. **Triage and severity classification** (CVSS 3.1) within **10 business days**.
3. **Fix development** in a private branch. Timeline depends on severity:
   - Critical (CVSS >= 9.0): target 14 days
   - High (7.0-8.9): target 30 days
   - Medium (4.0-6.9): target 60 days
   - Low (< 4.0): next scheduled release
4. **Coordinated disclosure**: public advisory is published after a fix
   is available, with credit to the reporter (unless anonymity is requested).
5. **Standard embargo**: **90 days** from initial report, or until a fix
   ships -- whichever is earlier.

## Scope

In scope for this policy:

- `crates/k-lani-core` -- storage, WAL, indexing, locking, EventBus Cognitive DLP cloud gate.
- `crates/k-lani-server` -- TCP wire protocol, handlers, HTTP surface, WASM cursor registration commands.
- `crates/k-lani-wasm` -- Wasmtime-backed cursor/filter sandbox and host-call ABI boundary.
- `crates/k-lani-ai-proxy` -- agent relay, provider-key vault, HTTP
  dashboard/API trace surface.
- `crates/k-lani-adapter-quic` -- QUIC / WebTransport adapter surface, generic
  MCP JSON-RPC/SSE transport helpers, and local demo bridge.
- `crates/bindran/api` -- BinDran authenticated QUIC/WebTransport application
  surface, callback-only production HTTP surface, signed Stripe webhook
  verification, migration-gated legacy HTTP application routes, creator and
  ingress WORM append surfaces, Argon2id transaction-PIN verification,
  controlled creator-image moderation/report surfaces, and public MCP
  AI-concierge tool provider.
- `crates/k-lani-adapter-sip` -- Fritzbox SIP REGISTER/Digest-auth boot, environment-only credential handling, RTP packet parsing, and G.711 a-law/u-law audio codec surface.
- `crates/k-lani-adapter-smtp` -- native SMTP TCP receiver, SMTP command handling, RFC822-style header parsing, and EmailReceivedEvent generation surface.
- `crates/k-lani-cli` -- production `serve-sip` launch wrapper for the SIP adapter, local operational command surface, and the `klani_vision_node` ROS 2 / Isaac Sim vision-topic adapter boundary.
- `crates/k-lani-adapter-cv` -- pure-Rust image decoding and coarse-grid ROI detection adapter.
- `crates/k-lani-adapter-robotics` -- Zenoh robotics pub/sub bridge and local PiCar-X simulation adapter.
- `crates/k-lani-schema` -- schema parser, code generators.
- `examples/csharp-client-demo` -- reference C# client (for client-side
  protocol-handling issues).

Out of scope:

- Issues in third-party dependencies outside our direct control
  (report upstream; we may pick up the fix after).
- Denial-of-service achievable only via network-level flooding (outside
  the server's protocol layer).
- Issues requiring a non-default, explicitly unsafe configuration.

## Recovery and WAL Archive Guarantees

Normal active-WAL crash recovery remains tail-tolerant: a torn final write can
be discarded so the table reopens to the last committed state.

Archived point-in-time recovery is stricter. `Table::restore_from_wal_archive`
validates the ordered `ArchivedWalSegment` chain before replaying it. Missing
segments, out-of-order sequences, checksum/truncation/header corruption, and
broken WAL previous-hash continuity fail closed with typed errors instead of
silently restoring from a partial or damaged archive.

Production checkpoint archives are named
`<table>-<sequence:016>-<timestamp_ms>.mkwal`. The server PITR API and
`mkfx-pitr` command derive recovery order from the sequence field and require an
empty target directory. A checkpoint boundary may reset the first entry's
previous-hash pointer to `0`; within each segment the WAL hash chain remains
strict, and continuous segments must still match the previous segment hash.

## Software Bill of Materials (SBOM)

Direct Rust dependency names are gated by `.cargo/dependency-allowlist.txt`.
Resolved external package versions from `Cargo.lock`, including transitive
dependencies, are gated by `.cargo/package-allowlist.txt`. Check both with:

```
cargo xtask dependency-policy --check
```

This complements `cargo audit`: new direct crates and new resolved external
package versions must be reviewed before they are added to the allowlists,
reducing typo/slopsquatting and unexpected transitive-update risk before a crate
can enter the dependency graph.

Release binaries are built with [`cargo-auditable`](https://github.com/rust-secure-code/cargo-auditable),
embedding the full dependency graph. Extract with:

```
cargo audit bin target/release/mkfx
```

Core runtime dependency surface is intentionally minimal
(only `memmap2` in `marvins-k-lani-core`).

## Cryptography and Integrity

The engine uses BLAKE3 for payload content hashing in the Memo store
(see [crates/marvins-k-lani-core/src/hash.rs](crates/marvins-k-lani-core/src/hash.rs)).
UUID v7 is used for record identifiers -- timestamps embedded in record
IDs are a documented feature and are not a cryptographic guarantee of
chronological order against a malicious writer with local write access.

## Legal

See [LICENSE.md](LICENSE.md) for liability terms. In particular, §4
(Data Care and Forensic Evidence) applies in any post-incident analysis.

The project's posture under the EU Product Liability Directive 2024/2853
is documented in [`LICENSE.md` §§13–14](LICENSE.md) (no-consumer-distribution,
component nature, FOSS-supply statement, professional-data assumption) and
in [`ADR-0017`](docs/adr/0017-eu-pld-defensive-posture.md). The honest list
of capability boundaries that calibrates the project's "reasonable safety
expectation" under PLD lives at [`docs/limits.md`](docs/limits.md). A
security-relevant defect within the meaning of PLD is assessed against
those boundaries, not against undocumented or aspirational ones.
