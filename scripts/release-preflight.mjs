import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseKeyId, releasePublicKey } from "./release-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const expectedTag = `v${packageJson.version}`;
const tag = process.env.GITHUB_REF_NAME?.trim() || expectedTag;
const isGitHubRelease = process.env.GITHUB_ACTIONS === "true" &&
  process.env.GITHUB_REF?.startsWith("refs/tags/v");

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag} does not match package version ${packageJson.version}.`);
}
if (packageJson.license !== "GPL-2.0-or-later") {
  throw new Error("CodeY CMS release metadata must declare GPL-2.0-or-later.");
}
if (isGitHubRelease && process.env.GITHUB_REPOSITORY !== "fpointerdev/codey-cms") {
  throw new Error("Official releases can only be published from fpointerdev/codey-cms.");
}
if (isGitHubRelease) {
  const checkoutCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(checkoutCommit) || checkoutCommit !== process.env.GITHUB_SHA) {
    throw new Error("Release checkout does not match the GitHub tag commit.");
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", checkoutCommit, "origin/main"], {
      cwd: root,
      stdio: "ignore"
    });
  } catch {
    throw new Error("Official release tags must point to a commit on origin/main.");
  }
}

const notesFile = path.join(root, "docs", "releases", `${tag}.md`);
const notes = await readFile(notesFile, "utf8").catch(() => "");
if (!notes.trim()) {
  throw new Error(`Release notes are missing: docs/releases/${tag}.md.`);
}
if (!notes.includes(`CodeY CMS ${packageJson.version}`)) {
  throw new Error(`Release notes must identify CodeY CMS ${packageJson.version}.`);
}

const privateKey = process.env.CODEY_RELEASE_PRIVATE_KEY?.trim();
if (!privateKey) {
  throw new Error("CODEY_RELEASE_PRIVATE_KEY is required for an official release.");
}
const publicKey = releasePublicKey(privateKey);

console.log(`Release preflight passed for ${tag}.`);
console.log(`Signing key: ${releaseKeyId(publicKey)}`);
console.log(`Release notes: docs/releases/${tag}.md`);
