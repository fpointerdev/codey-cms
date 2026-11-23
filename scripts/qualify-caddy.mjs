import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const imageIndex = process.argv.indexOf("--image");
const image = imageIndex < 0 ? "codey-cms-caddy:security" : process.argv[imageIndex + 1];
if (!image) throw new Error("--image requires a built Caddy image.");
const pins = JSON.parse(await readFile(path.join(root, "runtime-meta/container-images.json"), "utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "codey-caddy-qualification-"));
const name = `codey-caddy-test-${randomUUID()}`;
const backend = `${name}-backend`;
const domain = "qualification.test";
const fixture = `
  require('node:http').createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ path: req.url, method: req.method,
      body: Buffer.concat(chunks).toString(), protocol: req.headers['x-forwarded-proto'],
      authorization: req.headers.authorization, padding: 'x'.repeat(2048) }));
  }).listen(4000, '0.0.0.0');
`;

try {
  if (imageIndex < 0) docker(["build", "-f", "Dockerfile.caddy", "-t", image, "."]);
  const buildInfo = docker(["run", "--rm", image, "caddy", "build-info"]);
  assert.doesNotMatch(buildInfo, /github\.com\/go-jose\/go-jose\/v3\s/);
  assert.match(buildInfo, /github\.com\/smallstep\/certificates\s+v0\.30\.3-0\.20261105213751-6d5a251fbe01/);
  assert.match(buildInfo, /golang\.org\/x\/net\s+v0\.62\.0/);
  const modules = docker(["run", "--rm", image, "caddy", "list-modules"]);
  for (const module of ["tls.issuance.acme", "tls.issuance.internal", "http.handlers.acme_server", "http.handlers.reverse_proxy"]) {
    assert.ok(modules.split(/\r?\n/).includes(module), `Missing standard Caddy module: ${module}`);
  }
  // Trust only this test's CA; never alter the host trust store or disable TLS validation.
  await writeFile(path.join(temporary, "Caddyfile"), `{
  local_certs
  skip_install_trust
}
${await readFile(path.join(root, "Caddyfile"), "utf8")}`);
  docker(["network", "create", name]);
  docker(["run", "-d", "--name", backend, "--network", name, "--network-alias", "backend",
    pins.node, "node", "-e", fixture]);
  docker(["run", "-d", "--name", name, "--network", name,
    "--read-only", "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE", "--security-opt", "no-new-privileges:true",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=32m", "-e", `CODEY_DOMAIN=${domain}`,
    "-p", "127.0.0.1::443", "-p", "127.0.0.1::80",
    "-v", "/data", "-v", "/config",
    "-v", `${temporary}/Caddyfile:/etc/caddy/Caddyfile:ro`, image]);
  const inspect = JSON.parse(docker(["inspect", name]))[0];
  let httpsPort = Number(inspect.NetworkSettings.Ports["443/tcp"][0].HostPort);
  const httpPort = Number(inspect.NetworkSettings.Ports["80/tcp"][0].HostPort);
  const caPath = path.join(temporary, "root.crt");
  await retry(async () => docker(["cp", `${name}:/data/caddy/pki/authorities/local/root.crt`, caPath]));
  const ca = await readFile(caPath);
  const request = (method = "GET", body) => new Promise((resolve, reject) => {
    const req = https.request({ hostname: "127.0.0.1", port: httpsPort, servername: domain,
      path: "/api/v1/example?test=1", method, ca, agent: false, signal: AbortSignal.timeout(5000),
      headers: { host: domain, "accept-encoding": "gzip", authorization: "Bearer qualification-only" }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          assert.equal(response.statusCode, 200);
          assert.equal(response.headers["content-encoding"], "gzip");
          const result = JSON.parse(gunzipSync(Buffer.concat(chunks)).toString());
          assert.equal(result.protocol, "https");
          assert.equal(result.path, "/api/v1/example?test=1");
          assert.equal(result.method, method);
          assert.equal(result.authorization, "Bearer qualification-only");
          assert.equal(result.body, body || "");
          resolve(result);
        } catch (error) { reject(error); }
      });
      response.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("HTTPS qualification timed out.")));
    req.on("error", reject);
    req.end(body);
  });
  await retry(() => request());
  await request("POST", JSON.stringify({ title: "Content through HTTPS" }));
  const redirect = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: httpPort, path: "/content",
      headers: { host: domain }, timeout: 5000
    }, (response) => { response.resume(); resolve(response); });
    req.on("timeout", () => req.destroy(new Error("HTTP redirect qualification timed out.")));
    req.on("error", reject);
  });
  assert.equal(redirect.statusCode, 308);
  assert.equal(redirect.headers.location, `https://${domain}/content`);
  docker(["restart", name]);
  // Docker may allocate a new ephemeral host port when restarting the container.
  httpsPort = Number(JSON.parse(docker(["inspect", name]))[0].NetworkSettings.Ports["443/tcp"][0].HostPort);
  await retry(() => request());
  console.log("Caddy qualified: patched modules, verified HTTPS, redirect, compression, authenticated POST, and certificate persistence after restart.");
} catch (error) {
  try { execFileSync("docker", ["logs", name], { stdio: "inherit" }); } catch { /* Container may not have started. */ }
  throw error;
} finally {
  // Only containers created by this invocation, including their anonymous test storage.
  docker(["rm", "-f", "-v", name, backend], true);
  docker(["network", "rm", name], true);
  await rm(temporary, { recursive: true, force: true });
}

function docker(args, allowFailure = false) {
  try {
    return execFileSync("docker", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    if (!allowFailure) throw error;
    return "";
  }
}

async function retry(operation) {
  const deadline = Date.now() + 60_000;
  let lastError;
  while (Date.now() < deadline) {
    try { return await operation(); } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError;
}
