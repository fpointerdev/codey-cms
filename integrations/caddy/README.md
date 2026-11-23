# CodeY Caddy Build

This is the standard Caddy 2.11.9 entrypoint with a locked dependency graph, not
a fork of its TLS or cryptographic implementation. `Dockerfile.caddy` uses
digest-pinned Go and Caddy images, Go checksum verification, and a read-only
module graph during compilation. All standard modules remain available.

The official 2.11.9 binary still contains two dependencies flagged by Trivy:

- `go-jose/v3`: removed by the upstream Smallstep migration merged at
  [`6d5a251fbe010383c93ead1ab451a329986b80ca`](https://github.com/smallstep/certificates/commit/6d5a251fbe010383c93ead1ab451a329986b80ca).
  The pinned Go pseudo-version identifies that exact commit; it uses patched
  `go-jose/v4` rather than a local crypto patch.
- `golang.org/x/net`: pinned to 0.62.0 for CVE-2026-78661.

`go.mod` and `go.sum` lock the complete module graph. The signed release records
their SHA-256 hashes and the Go builder digest. Never use `@latest`, unverified
downloads, scanner ignores, or `-mod=mod` in the release build.

To change these pins, regenerate the module graph with the pinned Go toolchain,
review the dependency diff, then run:

```sh
pnpm audit:containers
pnpm release:caddy
```

The image gate blocks all high/critical findings, including unfixed findings.
The TLS qualifier trusts only its temporary CA and does not disable certificate
verification or change the host trust store. It checks HTTPS, redirects, gzip,
authenticated POST forwarding, standard modules, and certificate persistence.
Public ACME issuance still requires a real deployment with reachable DNS/ports.

Return to an official Caddy binary only after its image passes the same gates.
