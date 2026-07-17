const prismaOnlyParameters = new Set([
  "connection_limit",
  "pgbouncer",
  "pool_timeout",
  "schema",
  "socket_timeout",
  "statement_cache_size"
]);

export function postgresCliUrl(value) {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
  }

  for (const parameter of prismaOnlyParameters) url.searchParams.delete(parameter);
  return url.toString();
}

export function postgresCliConnection(value) {
  const url = new URL(postgresCliUrl(value));
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  url.password = "";

  return {
    url: url.toString(),
    password
  };
}
