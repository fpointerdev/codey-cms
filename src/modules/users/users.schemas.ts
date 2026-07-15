import { z } from "zod";

export const userIdParams = z.object({
  id: z.string().cuid()
});

export const listUsersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(160).optional(),
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional()
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  roleIds: z.array(z.string().cuid()).min(1).max(20).refine(
    (roleIds) => new Set(roleIds).size === roleIds.length,
    "Role IDs must be unique."
  ).optional()
}).refine((input) => Object.keys(input).length > 0, "At least one user field must be provided.");
