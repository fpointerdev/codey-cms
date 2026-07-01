import { z } from "zod";

export const createNotificationSchema = z.object({
  userId: z.string().cuid().optional(),
  channel: z.enum(["SYSTEM", "EMAIL"]).default("SYSTEM"),
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(4000),
  metadata: z.record(z.unknown()).optional()
});
