# Security Policy

Thanks for helping keep Kensa and its users safe.

## Supported Versions

Kensa is on an active 0.x release train. Only the most recent minor version
receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security reports.** Instead,
use one of the private channels below so the issue can be triaged and fixed
before details become public:

1. **Preferred** — GitHub's private vulnerability reporting
   (<https://github.com/Aswikinz/Kensa/security/advisories/new>).
2. **Alternative** — email the maintainer listed in the repository's
   `Cargo.toml` / `package.json` metadata with the subject line
   `[kensa-security]`.

When you report, please include:

- The affected component (Rust engine, TypeScript extension host, Python
  helper, webview renderer, notebook renderer).
- Kensa version (see `package.json`) and VS Code version.
- A minimal reproduction: the exact file / kernel variable / operation
  sequence that triggers the issue.
- The impact you observed (crash, unexpected file access, code execution,
  information disclosure, etc.).
- Any suggested fix or references to CVEs in upstream dependencies.

We aim to acknowledge reports within **72 hours** and publish a fix within
**30 days** for critical issues, longer for lower-severity findings. You'll
be credited in the release notes unless you ask otherwise.

## Threat Model & Scope

Kensa runs **locally inside VS Code** on trusted developer machines. It is
not a multi-tenant service. The following are **in scope** for security
reports:

- Arbitrary code execution triggered by opening a data file (CSV, TSV,
  Parquet, Excel, JSONL) that Kensa declares as supported.
- Escaping the webview sandbox (CSP bypass, script injection via column
  names, cell values, or file metadata rendered in the grid).
- Path traversal, symlink attacks, or writes outside the directory the
  user explicitly chose in an export dialog.
- Leaking local file contents, environment variables, kernel state, or
  secrets to an attacker who controls only a data file.
- Denial of service that crashes VS Code or leaves the Rust / Python
  engines in an unrecoverable state.
- Supply-chain issues in our pinned Rust crates or npm dependencies.

The following are **out of scope** (by design):

- Kensa's Editing mode intentionally executes user-authored Python code
  via `exec()` in `src/python/kensa_helpers.py`. That's the product: the
  user is expected to trust the code they see in the Code Preview panel
  before hitting Apply / Run. Reports of "exec() is unsafe" without a
  specific bypass will be closed.
- Jupyter kernel variable extraction uses `pickle.load()` on a temp file
  produced by the user's own kernel. If an attacker controls the kernel,
  they already have code execution; the pickle step does not expand that.
- Theft of data by a user with full filesystem access to their own
  machine — that's the expected trust boundary for a local tool.
- Vulnerabilities in VS Code itself, the ms-toolsai.jupyter extension,
  the system Python interpreter, or pandas / numpy / pyarrow. Please
  report those upstream.

## Hardening Notes

- The webview uses a strict Content-Security-Policy built per-panel in
  `src/extension/webviewProvider.ts`; scripts execute only with a nonce
  bound to that panel's HTML. There is no `unsafe-eval`.
- The Rust native module uses `Result<T, KensaError>` end-to-end and
  never calls `unwrap()` on untrusted input. CSV / Parquet / Excel /
  JSONL readers handle malformed files with typed errors rather than
  panics.
- The Python subprocess has a 15-second readiness timeout and captures
  stderr so failures surface as visible errors instead of silent hangs.
- The `kensa.pythonPath` setting allows pinning an interpreter; if unset,
  Kensa uses the PATH interpreter.

## Disclosure

Once a fix is released, we publish a GitHub Security Advisory with a CVE
(when applicable), credit the reporter, and note the fix in the
`CHANGELOG.md`.
