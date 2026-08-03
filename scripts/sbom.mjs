import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function createProductionSbom({ name, version, timestamp, commit, containerImages, apkPackages }, cwd) {
  const licenses = JSON.parse(execFileSync(
    "pnpm",
    ["licenses", "list", "--prod", "--json"],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  ));
  const components = new Map();

  for (const [licenseGroup, packages] of Object.entries(licenses)) {
    for (const dependency of packages) {
      for (const dependencyVersion of dependency.versions || []) {
        const key = `${dependency.name}@${dependencyVersion}`;
        const component = components.get(key) || {
          type: "library",
          name: dependency.name,
          version: dependencyVersion,
          purl: npmPurl(dependency.name, dependencyVersion),
          licenses: []
        };
        const license = dependency.license || licenseGroup;
        if (!component.licenses.some((item) => item.license.name === license)) {
          component.licenses.push({ license: { name: license } });
        }
        components.set(key, component);
      }
    }
  }

  const sortedComponents = [...components.values()]
    .map((component) => ({
      ...component,
      licenses: component.licenses.sort((left, right) => left.license.name.localeCompare(right.license.name))
    }))
    .sort((left, right) => left.purl.localeCompare(right.purl));
  const lockfileSha256 = createHash("sha256")
    .update(readFileSync(`${cwd}/pnpm-lock.yaml`))
    .digest("hex");
  const supplyChainProperties = [
    { name: "codey:source:repository", value: "https://github.com/fpointerdev/codey-cms" },
    { name: "codey:source:commit", value: commit },
    { name: "codey:dependencies:pnpm-lock-sha256", value: lockfileSha256 },
    ...Object.entries(containerImages || {}).map(([image, reference]) => ({
      name: `codey:container:${image}`,
      value: reference
    })),
    ...Object.entries(apkPackages || {}).map(([name, packageVersion]) => ({
      name: `codey:apk:${name}`,
      value: packageVersion
    }))
  ].sort((left, right) => left.name.localeCompare(right.name));

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      timestamp,
      component: {
        type: "application",
        name,
        version,
        purl: npmPurl(name, version),
        properties: supplyChainProperties
      }
    },
    components: sortedComponents
  };
}

export function assertProductionSbom(sbom, { name, version, commit, containerImages, apkPackages, lockfileSha256 }) {
  if (sbom?.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || sbom.version !== 1) {
    throw new Error("Release SBOM must use CycloneDX 1.6.");
  }
  if (sbom.metadata?.component?.name !== name || sbom.metadata.component.version !== version) {
    throw new Error("Release SBOM component does not match the release.");
  }
  if (!Number.isFinite(Date.parse(sbom.metadata?.timestamp))) {
    throw new Error("Release SBOM timestamp is invalid.");
  }
  const sourceCommit = sbom.metadata.component.properties?.find(
    (property) => property.name === "codey:source:commit"
  )?.value;
  if (sourceCommit !== commit) {
    throw new Error("Release SBOM source commit does not match the signed manifest.");
  }
  const properties = new Map((sbom.metadata.component.properties || []).map((property) => [property.name, property.value]));
  if (lockfileSha256 && properties.get("codey:dependencies:pnpm-lock-sha256") !== lockfileSha256) {
    throw new Error("Release SBOM dependency lockfile hash does not match the release.");
  }
  for (const [image, reference] of Object.entries(containerImages || {})) {
    if (properties.get(`codey:container:${image}`) !== reference) {
      throw new Error(`Release SBOM container image ${image} does not match the release.`);
    }
  }
  for (const [packageName, packageVersion] of Object.entries(apkPackages || {})) {
    if (properties.get(`codey:apk:${packageName}`) !== packageVersion) {
      throw new Error(`Release SBOM Alpine package ${packageName} does not match the release.`);
    }
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error("Release SBOM does not contain production dependencies.");
  }

  const identifiers = sbom.components.map((component) => component.purl);
  if (identifiers.some((identifier) => typeof identifier !== "string" || !identifier.startsWith("pkg:npm/"))) {
    throw new Error("Release SBOM contains an invalid package URL.");
  }
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error("Release SBOM contains duplicate components.");
  }
  if (identifiers.some((identifier, index) => index > 0 && identifier.localeCompare(identifiers[index - 1]) < 0)) {
    throw new Error("Release SBOM components are not deterministic.");
  }

  return sbom;
}

function npmPurl(name, version) {
  const packageName = name.startsWith("@")
    ? `${encodeURIComponent(name.split("/", 1)[0])}/${name.split("/").slice(1).join("/")}`
    : name;
  return `pkg:npm/${packageName}@${encodeURIComponent(version)}`;
}
