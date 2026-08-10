import { config } from "../src/config/index.js";
import { prisma } from "../src/infrastructure/database/prisma.js";
import { logger } from "../src/infrastructure/logging/logger.js";
import { reconcileReservedInventory } from "../src/modules/orders/inventory-reservation.service.js";

const flags = process.argv.slice(2);
if (flags.some((flag) => flag !== "--repair")) {
  throw new Error("Usage: pnpm inventory:reconcile [--repair]");
}

try {
  const report = await reconcileReservedInventory(
    { config, prisma, logger },
    { repair: flags.includes("--repair") }
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.healthy) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
