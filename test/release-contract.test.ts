import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  canonicalJson,
  compareSemver,
  createSignedRelease,
  createUnsignedRelease,
  verifyReleaseEnvelope
} from "../scripts/release-contract.mjs";

function releasePayload() {
  return {
    schemaVersion: 1,
    product: "codey-cms",
    version: "0.9.0",
    channel: "stable",
    releasedAt: "2026-07-22T00:00:00.000Z",
    contracts: {
      websiteSpec: "1.0",
      builder: "1.0"
    },
    artifact: {
      file: "codey-cms-0.9.0.tar.gz",
      url: "https://releases.example/codey-cms-0.9.0.tar.gz",
      sizeBytes: 1024,
      sha256: "a".repeat(64)
    }
  };
}

test("release JSON is canonical regardless of object insertion order", () => {
  assert.equal(
    canonicalJson({ z: 1, nested: { b: 2, a: 1 }, a: [2, { y: 2, x: 1 }] }),
    '{"a":[2,{"x":1,"y":2}],"nested":{"a":1,"b":2},"z":1}'
  );
});

test("signed release manifests verify and reject tampering", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signed = createSignedRelease(releasePayload(), privateKey);

  assert.equal(verifyReleaseEnvelope(signed.envelope, publicKey).version, "0.9.0");

  const tampered = structuredClone(signed.envelope);
  tampered.payload.artifact.sha256 = "b".repeat(64);
  assert.throws(
    () => verifyReleaseEnvelope(tampered, publicKey),
    /signature is invalid/
  );
});

test("unsigned release manifests are accepted only for explicit local qualification", () => {
  const unsigned = createUnsignedRelease(releasePayload());

  assert.throws(() => verifyReleaseEnvelope(unsigned), /not signed/);
  assert.equal(
    verifyReleaseEnvelope(unsigned, undefined, { allowUnsigned: true }).version,
    "0.9.0"
  );
});

test("release manifests reject unsafe artifact names and compare stable versions", () => {
  const payload = releasePayload();
  payload.artifact.file = "../codey-cms.tar.gz";

  assert.throws(() => createUnsignedRelease(payload), /file name is invalid/);
  assert.equal(compareSemver("0.9.1", "0.9.0"), 1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.0.0-beta.1", "1.0.0"), -1);
});
