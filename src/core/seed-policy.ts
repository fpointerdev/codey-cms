export function shouldSeedDemoContent(value = process.env.CODEY_SEED_DEMO_CONTENT) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}
