import { spawnSync } from "node:child_process";
import { postgresCliConnection } from "./postgres-cli-url.mjs";

const ownerUrl = requiredUrl("MIGRATION_DATABASE_URL");
const runtimeUrl = requiredUrl("DATABASE_URL");
const owner = new URL(ownerUrl);
const runtime = new URL(runtimeUrl);
const ownerRole = decodeURIComponent(owner.username);
const runtimeRole = decodeURIComponent(runtime.username);
const databaseName = decodeURIComponent(owner.pathname.replace(/^\//, ""));
const runtimePassword = decodeURIComponent(runtime.password);

for (const [label, value] of Object.entries({ ownerRole, runtimeRole, databaseName })) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(value)) {
    throw new Error(`${label} is not a safe PostgreSQL identifier.`);
  }
}
if (!runtimePassword || runtimePassword.length < 32) {
  throw new Error("The runtime database password is missing or too short.");
}
if (ownerRole === runtimeRole) {
  throw new Error("The migration and runtime database roles must be different.");
}

const sql = `
SET log_statement = 'none';
DO $codey$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(runtimeRole)}) THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', ${literal(runtimeRole)}, ${literal(runtimePassword)});
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', ${literal(runtimeRole)}, ${literal(runtimePassword)});
  END IF;
END
$codey$;
REVOKE ALL ON DATABASE ${identifier(databaseName)} FROM ${identifier(runtimeRole)};
GRANT CONNECT ON DATABASE ${identifier(databaseName)} TO ${identifier(runtimeRole)};
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ${identifier(runtimeRole)};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identifier(runtimeRole)};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier(runtimeRole)};
ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(ownerRole)} IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${identifier(runtimeRole)};
ALTER DEFAULT PRIVILEGES FOR ROLE ${identifier(ownerRole)} IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ${identifier(runtimeRole)};
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public."AuditLog" FROM ${identifier(runtimeRole)};
RESET log_statement;
`;

const connection = postgresCliConnection(ownerUrl);
const result = spawnSync("psql", [connection.url, "--set", "ON_ERROR_STOP=1"], {
  env: {
    ...process.env,
    ...(connection.password ? { PGPASSWORD: connection.password } : {})
  },
  input: sql,
  encoding: "utf8",
  stdio: ["pipe", "inherit", "inherit"]
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`Runtime database role setup exited with code ${result.status}.`);

function requiredUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function identifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function literal(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
