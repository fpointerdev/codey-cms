import type { RequestHandler } from "express";
import type { ModuleContext } from "../types/module.js";
import { safeWriteAuditLog } from "./audit-log.js";

const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createAdminMutationAudit(context: ModuleContext): RequestHandler {
  return (req, res, next) => {
    res.once("finish", () => {
      if (!req.user || !writeMethods.has(req.method.toUpperCase())) return;

      const path = req.originalUrl.split("?", 1)[0] || req.path;
      if (!path.startsWith(context.config.api.prefix)) return;

      const statusCode = res.statusCode;
      const denied = statusCode === 401 || statusCode === 403;
      const failed = statusCode >= 400;
      const subject = path
        .slice(context.config.api.prefix.length)
        .split("/")
        .filter(Boolean)[0] || "api";

      void safeWriteAuditLog(context.prisma, {
        actorUserId: req.user.id,
        action: denied ? "api.write.denied" : failed ? "api.write.failed" : "api.write",
        subject,
        ipAddress: req.ip,
        userAgent: req.header("user-agent"),
        requestId: req.requestId,
        outcome: denied ? "DENIED" : failed ? "FAILURE" : "SUCCESS",
        severity: denied ? "HIGH" : failed ? "WARN" : "INFO",
        metadata: {
          method: req.method.toUpperCase(),
          path,
          statusCode,
          traceId: req.traceId ?? null
        }
      });
    });

    next();
  };
}
