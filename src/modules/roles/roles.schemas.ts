import { z } from "zod";

export const roleIdParams = z.object({
  id: z.string().cuid()
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(240).optional(),
  permissionIds: z.array(z.string().cuid()).max(100).refine(
    (permissionIds) => new Set(permissionIds).size === permissionIds.length,
    "Permission IDs must be unique."
  ).default([])
});

export const updateRoleSchema = createRoleSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
  "At least one role field must be provided."
);
