import { execFileSync } from "node:child_process";

export function createProductionSbom({ name, version, timestamp, commit }, cwd) {
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
        properties: [
          { name: "codey:source:repository", value: "https://github.com/fpointerdev/codey-cms" },
          { name: "codey:source:commit", value: commit }
        ]
      }
    },
    components: sortedComponents
  };
}

export function assertProductionSbom(sbom, { name, version, commit }) {
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
