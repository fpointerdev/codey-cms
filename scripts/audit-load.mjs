const targetUrl = process.argv.slice(2).find((argument) => argument !== "--");
const baseUrl = new URL(targetUrl || process.env.PUBLIC_AUDIT_URL || "http://127.0.0.1:4173");
const requestCount = Math.max(30, Number(process.env.LOAD_SMOKE_REQUESTS || 300));
const concurrency = Math.max(1, Math.min(100, Number(process.env.LOAD_SMOKE_CONCURRENCY || 20)));
const maximumP95Ms = Math.max(100, Number(process.env.LOAD_SMOKE_P95_MS || 750));
const paths = ["/api/v1/health/ready", "/", "/sitemap.xml"];

async function fetchChecked(path) {
  const startedAt = performance.now();
  const response = await fetch(new URL(path, baseUrl), {
    headers: { accept: path.endsWith(".xml") ? "application/xml" : "text/html,application/json" }
  });
  const body = await response.text();
  const durationMs = performance.now() - startedAt;

  if (response.status !== 200) throw new Error(`${path} returned HTTP ${response.status}.`);
  if (path === "/" && !body.includes('data-server-rendered="true"')) {
    throw new Error("The public home page was not server-rendered.");
  }
  if (path === "/api/v1/health/ready") {
    const payload = JSON.parse(body);
    if (payload?.data?.status !== "ready") throw new Error("The runtime was not ready during the load smoke test.");
  }

  return durationMs;
}

for (const path of paths) await fetchChecked(path);

const durations = [];
const failures = [];
let nextRequest = 0;
const startedAt = performance.now();

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (true) {
    const requestIndex = nextRequest++;
    if (requestIndex >= requestCount) return;

    try {
      durations.push(await fetchChecked(paths[requestIndex % paths.length]));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
}));

const elapsedSeconds = (performance.now() - startedAt) / 1000;
const sortedDurations = durations.sort((left, right) => left - right);
const percentile = (value) => sortedDurations[Math.max(0, Math.ceil(sortedDurations.length * value) - 1)] || 0;
const result = {
  requests: requestCount,
  concurrency,
  failures: failures.length,
  requestsPerSecond: Number((requestCount / elapsedSeconds).toFixed(1)),
  p50Ms: Number(percentile(0.5).toFixed(1)),
  p95Ms: Number(percentile(0.95).toFixed(1)),
  p99Ms: Number(percentile(0.99).toFixed(1)),
  maximumP95Ms
};

console.log(JSON.stringify(result));

if (failures.length) {
  throw new Error(`Load smoke test had ${failures.length} failed requests: ${failures.slice(0, 3).join(" ")}`);
}
if (result.p95Ms > maximumP95Ms) {
  throw new Error(`Load smoke test p95 ${result.p95Ms}ms exceeded ${maximumP95Ms}ms.`);
}
