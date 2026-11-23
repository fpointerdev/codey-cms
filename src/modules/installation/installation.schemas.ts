import { z } from "zod";
import { newPasswordSchema } from "../../core/security/password.js";

export const completeInstallationSchema = z
  .object({
    claimToken: z.string().max(512).default(""),
    siteName: z.string().trim().min(2).max(120),
    profile: z.enum(["presentation", "cms", "shop"]).default("cms"),
    searchIndexing: z.boolean().default(false),
    admin: z
      .object({
        name: z.string().trim().min(1).max(120),
        email: z.string().email().max(254),
        password: newPasswordSchema(12)
      })
      .strict()
  })
  .strict();

export type CompleteInstallationInput = z.infer<typeof completeInstallationSchema>;
