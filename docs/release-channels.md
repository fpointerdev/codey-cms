# Release Channels

CodeY CMS exposes one end-user channel: `stable`.

Site owners and UseCodeY users never select a CMS version. New installations and new generated projects resolve the latest certified stable manifest automatically. Internally, CodeY records the exact semantic version, artifact SHA-256, signing key ID, and runtime contract versions so builds remain reproducible and can be rolled back.

## Signed Release Files

Every tagged release publishes:

- `stable.json`: current stable pointer with the signed manifest
- `codey-cms-<version>.manifest.json`: immutable Ed25519-signed release envelope
- `codey-cms-<version>.tar.gz`: runtime artifact used by managed updates and UseCodeY provisioning
- `codey-cms-<version>.zip`: downloadable self-host package
- `release-public-key.pem`: public verification key
- `SHA256SUMS`: artifact checksums

The stable pointer is not trusted by itself. Consumers verify the embedded signed manifest, release product, stable channel, semantic version, runtime contracts, artifact size, and SHA-256 before accepting an artifact.

## Publishing

1. Update `package.json` to the intended semantic version.
2. Run `pnpm run test:release` against the qualification database.
3. Create and push the matching tag, for example `v0.9.0`.
4. GitHub Actions builds the release from that exact tag and refuses a tag/package mismatch.
5. The release job signs with the protected `CODEY_RELEASE_PRIVATE_KEY` secret and publishes immutable files.

The private signing key must never enter this repository, a runtime image, a generated website, or a downloadable package. Rotating the release key requires a separately authenticated trust migration for installed runtimes and UseCodeY.
