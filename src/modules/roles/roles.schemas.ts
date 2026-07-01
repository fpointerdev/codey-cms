import { z } from "zod";

export const roleIdParams = z.object({
  id: z.string().cuid()
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).optional(),
  permissionIds: z.array(z.string().cuid()).default([])
});

export const updateRoleSchema = createRoleSchema.partial();
