import { config } from "./config/index.js";
import { createApp } from "./core/app.js";
import { prisma } from "./infrastructure/database/prisma.js";
import { logger } from "./infrastructure/logging/logger.js";

const app = await createApp();

const server = app.listen(config.api.port, () => {
  logger.info(
    {
      port: config.api.port,
      env: config.env,
      mode: config.app.mode,
      apiPrefix: config.api.prefix
    },
    "API server started"
  );
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down API server");

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
