import { z } from "zod";

export const userIdParams = z.object({
  id: z.string().cuid()
});

export const listUsersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional()
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional(),
  roleIds: z.array(z.string().cuid()).optional()
});
