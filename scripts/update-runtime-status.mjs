import { PrismaClient } from "@prisma/client";
import { writeScriptAuditLog } from "./audit-log.mjs";

const prisma = new PrismaClient();
const [updateId, status] = process.argv.slice(2);
const allowedStatuses = new Set(["APPLYING", "SUCCEEDED", "FAILED", "ROLLED_BACK"]);

if (!updateId || !allowedStatuses.has(status)) {
  throw new Error("Usage: update-runtime-status.mjs <update-id> <status> [--backup-id value] [--error value]");
}

try {
  const update = await prisma.runtimeUpdate.findUnique({ where: { id: updateId } });
  if (!update) throw new Error(`Runtime update was not found: ${updateId}.`);

  const now = new Date();
  const backupId = readArg("backup-id");
  const error = readArg("error")?.slice(0, 2000);
  const completed = ["SUCCEEDED", "FAILED", "ROLLED_BACK"].includes(status);

  await prisma.$transaction(async (tx) => {
    await tx.runtimeUpdate.update({
      where: { id: updateId },
      data: {
        status,
        ...(status === "APPLYING" ? { startedAt: now } : {}),
        ...(completed ? { completedAt: now } : {}),
        ...(backupId ? { backupId } : {}),
        ...(error ? { error } : {})
      }
    });

    if (status === "SUCCEEDED") {
      await tx.runtimeInstallation.update({
        where: { id: "primary" },
        data: { runtimeVersion: update.toVersion }
      });
    }

    const site = await tx.site.findUnique({ where: { slug: "default" } });
    if (site) {
      await tx.moduleSetting.upsert({
        where: {
          siteId_moduleId_key: {
            siteId: site.id,
            moduleId: "config",
            key: "maintenance"
          }
        },
        update: {
          value: status === "APPLYING"
            ? {
                enabled: true,
                message: "CodeY CMS is installing a verified update.",
                allowedPaths: ["/health"]
              }
            : { enabled: false }
        },
        create: {
          siteId: site.id,
          moduleId: "config",
          key: "maintenance",
          value: status === "APPLYING"
            ? {
                enabled: true,
                message: "CodeY CMS is installing a verified update.",
                allowedPaths: ["/health"]
              }
            : { enabled: false }
        }
      });
    }

    await writeScriptAuditLog(tx, {
      actorUserId: update.requestedByUserId,
      action: `runtime.update.${status.toLowerCase()}`,
      subject: "runtime",
      subjectId: updateId,
      outcome: ["FAILED", "ROLLED_BACK"].includes(status) ? "FAILURE" : "SUCCESS",
      severity: ["FAILED", "ROLLED_BACK"].includes(status) ? "HIGH" : "INFO",
      metadata: {
        fromVersion: update.fromVersion,
        toVersion: update.toVersion,
        backupId: backupId || update.backupId,
        error: error || null
      }
    });
  });
} finally {
  await prisma.$disconnect();
}

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
