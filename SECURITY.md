# Security Policy -- k-lani-coder

## Supported Versions

Security fixes are applied to the latest public `main` state. The repository is
a single-commit mirror of the newest evaluation bundle, not the source
monorepo. Public evaluation binaries declare their expiry through `--version`.

| Version | Supported |
| --- | --- |
| latest `main` bundle | yes |
| replaced public bundles | no |

## Reporting a Vulnerability

**Do not open public GitHub issues for security vulnerabilities.**

Report security issues privately through:

- **Email:** security@kalanis.de
- **GitHub Private Vulnerability Reporting:** Security tab -> Report a vulnerability

Include the affected binary version or commit, impact, reproduction steps, and
any suggested mitigation when possible.

## Disclosure Process

1. Acknowledgement within **5 business days**.
2. Triage and CVSS 3.1 severity classification within **10 business days**.
3. Target fix timelines:
   - Critical: 14 days
   - High: 30 days
   - Medium: 60 days
   - Low: next scheduled release
4. Coordinated disclosure after a fix is available, with reporter credit unless
   anonymity is requested.
5. Standard embargo: **90 days** from the initial report, or until a fix ships,
   whichever is earlier.

## Public Bundle Scope

This policy covers only the artifacts and operational surfaces shipped in this
public repository:

- `bin/k-lani-coder`
  - Rust, TypeScript/JavaScript, C#, and Python source indexing.
  - MCP stdio server and loopback session hub.
  - Symbol-scoped context assembly and hash-guarded write-back.
  - Ticket scope, model pinning, classification/residency claim checks, policy
    bouncer, formatter, and project gate.
  - Append-only tool, ticket, change, audition, receipt, and release evidence.
  - Loopback board dashboard and its local HTTP API.
- `bin/k-lani-ai-proxy`
  - Operator-configured upstream relay.
  - API-key injection/vault and protected-literal masking.
  - Account-pool retry behavior.
  - Request/response trace dashboard and append-only token/cost ledger.
- The included Docker image/Compose configuration, prompts, demo scripts, and
  documentation as they configure or describe those two binaries.

The closed-source k-lani engine embedded inside the binaries is in scope only
where its behavior is reachable through these shipped surfaces.

## Important Boundaries

- Both dashboards expose sensitive operational data. Bind them to loopback and
  do not expose them to an untrusted network.
- Proxy traces can contain prompts, responses, and source code. Credential
  masking does not make trace payloads public-safe.
- `k-lani-coder` opens no provider connection itself. `k-lani-ai-proxy`
  connects only to the upstream configured by the operator.
- The write policy bouncer is a best-effort guard against careless model output,
  not a sandbox for hostile code. The repository's own formatter, compiler,
  tests, review process, and operating-system isolation remain required.
- Classification and residency enforcement depends on truthful model-registry
  entries supplied by the operator.
- The board and ledgers are local operational evidence. Protect their data
  directory with normal host access controls and backups.

## Out of Scope

- Any k-lani source crate, server, adapter, application, or protocol surface not
  present in this public repository.
- Third-party model providers, models, runtimes, agent clients, and dependencies
  outside our direct control.
- Provider-account policy violations or use of account pools contrary to a
  provider's terms.
- Issues requiring an explicitly unsafe configuration, such as exposing a
  dashboard to an untrusted network despite the documented loopback rule.
- Network-level denial-of-service outside the shipped applications' protocol
  handling.

## Binary Integrity and SBOM

`bin/SHA256SUMS` records the hashes of the two shipped binaries. Public release
builds use `cargo-auditable` when available so operators can inspect their
embedded Rust dependency graphs:

```bash
sha256sum -c bin/SHA256SUMS
cargo audit bin bin/k-lani-coder
cargo audit bin bin/k-lani-ai-proxy
```

If a build was produced without `cargo-auditable`, the build script prints that
fact explicitly.

## Legal

See [LICENSE.md](LICENSE.md) for the terms governing this evaluation bundle.
