import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const canonicalGplV2Sha256 = "8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643";

test("distribution keeps the CodeY CMS GPL notices intact", async () => {
  const [license, notice, packageSource, releaseBuilder, dockerfile] = await Promise.all([
    readFile("LICENSE", "utf8"),
    readFile("NOTICE.md", "utf8"),
    readFile("package.json", "utf8"),
    readFile("scripts/build-release.mjs", "utf8"),
    readFile("Dockerfile", "utf8")
  ]);
  const packageJson = JSON.parse(packageSource) as {
    author?: string;
    license?: string;
    repository?: { url?: string };
  };

  assert.equal(createHash("sha256").update(license).digest("hex"), canonicalGplV2Sha256);
  assert.equal(packageJson.author, "Fatlum Prekadini");
  assert.equal(packageJson.license, "GPL-2.0-or-later");
  assert.equal(packageJson.repository?.url, "git+https://github.com/fpointerdev/codey-cms.git");
  assert.match(notice, /Copyright \(C\) 2026 Fatlum Prekadini and CodeY CMS contributors\./);
  assert.match(notice, /does not modify the GPL or add restrictions/);

  for (const file of ["LICENSE", "NOTICE.md"]) {
    assert.match(releaseBuilder, new RegExp(`"${file.replace(".", "\\.")}"`));
    assert.match(dockerfile, new RegExp(`/app/${file.replace(".", "\\.")}`));
  }

  assert.match(dockerfile, /org\.opencontainers\.image\.licenses="GPL-2\.0-or-later"/);
});
