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
import { assertProductionSbom } from "../scripts/sbom.mjs";

function releasePayload() {
  return {
    schemaVersion: 1,
    product: "codey-cms",
    version: "0.9.0",
    channel: "stable",
    releasedAt: "2026-07-22T00:00:00.000Z",
    contracts: {
      websiteSpec: "1.0",
      builder: "1.0",
      exportedSiteAcceptance: "1.0"
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

test("hardened release manifests require source, image, and SBOM provenance", () => {
  const payload: any = releasePayload();
  payload.contracts = {
    ...payload.contracts,
    operationalDiagnostics: "1.0",
    offsiteBackupReadiness: "1.0",
    supplyChain: "1.0"
  };
  payload.supplyChain = {
    source: {
      repository: "https://github.com/fpointerdev/codey-cms",
      commit: "a".repeat(40)
    },
    containerImages: {
      node: `node:24-alpine@sha256:${"b".repeat(64)}`,
      postgres: `postgres:16-alpine@sha256:${"c".repeat(64)}`
    },
    sbom: {
      file: "codey-cms-0.9.0.sbom.cdx.json",
      url: "https://releases.example/codey-cms-0.9.0.sbom.cdx.json",
      sizeBytes: 2048,
      sha256: "d".repeat(64)
    }
  };

  assert.doesNotThrow(() => createUnsignedRelease(payload));
  payload.supplyChain.source.commit = "unknown";
  assert.throws(() => createUnsignedRelease(payload), /provenance is invalid/);
});

test("CycloneDX release SBOM validation binds the source commit", () => {
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      timestamp: "2026-07-28T00:00:00.000Z",
      component: {
        name: "codey-cms",
        version: "0.9.3",
        properties: [{ name: "codey:source:commit", value: "a".repeat(40) }]
      }
    },
    components: [{ purl: "pkg:npm/express@4.22.2" }]
  };

  assert.equal(assertProductionSbom(sbom, {
    name: "codey-cms",
    version: "0.9.3",
    commit: "a".repeat(40)
  }), sbom);
  assert.throws(() => assertProductionSbom(sbom, {
    name: "codey-cms",
    version: "0.9.3",
    commit: "b".repeat(40)
  }), /source commit/i);
});
