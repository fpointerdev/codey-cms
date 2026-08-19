import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageBuildArguments = {
  openssl: "CODEY_APK_OPENSSL_VERSION",
  "postgresql16-client": "CODEY_APK_POSTGRESQL16_CLIENT_VERSION"
};

export async function preparePreviousRuntimeBuild(runtimeRoot, targetPackages) {
  const metadataPath = path.join(runtimeRoot, "runtime-meta", "container-images.json");
  const dockerfilePath = path.join(runtimeRoot, "Dockerfile");
  const composePath = path.join(runtimeRoot, "docker-compose.selfhost.yml");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  let dockerfile = await readFile(dockerfilePath, "utf8");
  const compose = await readFile(composePath, "utf8");
  const environment = {};
  const refreshedPackages = [];

  if (!targetPackages || typeof targetPackages !== "object" || Array.isArray(targetPackages)) {
    throw new Error("Candidate release does not declare Alpine package pins.");
  }
  const previousPackages = metadata.apkPackages;
  if (!previousPackages || typeof previousPackages !== "object" || Array.isArray(previousPackages)) {
    throw new Error("Previous release does not declare Alpine package pins.");
  }
  const previousNames = Object.keys(previousPackages).sort();
  const targetNames = Object.keys(targetPackages).sort();
  if (previousNames.join("\0") !== targetNames.join("\0")) {
    throw new Error("Previous and candidate releases declare different Alpine package sets.");
  }

  for (const [name, targetVersion] of Object.entries(targetPackages)) {
    const previousVersion = previousPackages[name];
    const buildArgument = packageBuildArguments[name];
    assertPackagePin(name, previousVersion, "previous");
    assertPackagePin(name, targetVersion, "candidate");
    if (!buildArgument) {
      throw new Error(`Alpine package ${name} has no approved compatibility build argument.`);
    }

    environment[buildArgument] = targetVersion;
    const packageReference = `${name}=\${${buildArgument}}`;
    const composeReference = `${buildArgument}: \${${buildArgument}:-${previousVersion}}`;

    if (dockerfile.includes(packageReference) && compose.includes(composeReference)) {
      if (previousVersion !== targetVersion) {
        refreshedPackages.push({
          name,
          fromVersion: previousVersion,
          toVersion: targetVersion,
          method: "docker-build-argument"
        });
      }
      continue;
    }

    const legacyReference = `${name}=${previousVersion}`;
    const occurrences = countOccurrences(dockerfile, legacyReference);
    if (occurrences !== 1) {
      throw new Error(
        `Previous runtime package pin ${legacyReference} is not an approved legacy Dockerfile shape.`
      );
    }
    if (previousVersion !== targetVersion) {
      dockerfile = dockerfile.replace(legacyReference, `${name}=${targetVersion}`);
      refreshedPackages.push({
        name,
        fromVersion: previousVersion,
        toVersion: targetVersion,
        method: "verified-legacy-pin-refresh"
      });
    }
  }

  if (refreshedPackages.some((item) => item.method === "verified-legacy-pin-refresh")) {
    await writeFile(dockerfilePath, dockerfile, "utf8");
  }

  return {
    environment,
    report: {
      status: "passed",
      refreshedPackages
    }
  };
}

function assertPackagePin(name, version, source) {
  if (typeof version !== "string" || !/^\d[0-9A-Za-z.+_-]*-r\d+$/.test(version)) {
    throw new Error(`${source} Alpine package pin is invalid: ${name}=${String(version)}.`);
  }
}

function countOccurrences(value, search) {
  return value.split(search).length - 1;
}
