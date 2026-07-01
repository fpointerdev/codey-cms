import type { Router } from "express";
import type { ModuleContext } from "../../core/types/module.js";
import { asyncHandler } from "../../core/http/async-handler.js";
import { sendCreated, sendSuccess } from "../../core/http/response.js";
import { validateRequest } from "../../core/http/validation.middleware.js";
import { requireAuth, requirePermission } from "../auth/auth.middleware.js";
import { createNotificationSchema } from "./notifications.schemas.js";

export function registerNotificationRoutes(router: Router, context: ModuleContext) {
  router.get(
    "/me",
    requireAuth(context),
    asyncHandler(async (req, res) => {
      const notifications = await context.prisma.notification.findMany({
        where: { userId: req.user!.id },
        orderBy: { createdAt: "desc" },
        take: 50
      });

      return sendSuccess(res, { notifications });
    })
  );

  router.post(
    "/",
    requirePermission(context, "create", "notifications"),
    validateRequest({ body: createNotificationSchema }),
    asyncHandler(async (req, res) => {
      const notification = await context.prisma.notification.create({
        data: req.body
      });

      return sendCreated(res, { notification });
    })
  );
}
