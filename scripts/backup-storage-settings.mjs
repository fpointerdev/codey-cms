export function resolveBackupStorage(environment = {}, stored = null) {
  const environmentDriver = environment.STORAGE_DRIVER || "local";
  const provider = ["local", "s3", "r2"].includes(stored?.provider)
    ? stored.provider
    : environmentDriver === "s3" ? "s3" : environmentDriver;
  const driver = provider === "s3" || provider === "r2" ? "s3" : provider;

  return {
    provider,
    driver,
    bucket: driver === "s3" ? stored?.bucket || environment.STORAGE_S3_BUCKET || null : null,
    keyPrefix: environment.STORAGE_KEY_PREFIX || null
  };
}
