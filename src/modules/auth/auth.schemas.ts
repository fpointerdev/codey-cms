import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120).optional()
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(32)
});

export const logoutSchema = refreshSchema;

export const requestPasswordResetSchema = z.object({
  email: z.string().email()
});

export const confirmPasswordResetSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(128)
});

export const requestEmailVerificationSchema = z.object({
  email: z.string().email()
});

export const confirmEmailVerificationSchema = z.object({
  token: z.string().min(32)
});

export const createInviteSchema = z.object({
  email: z.string().email(),
  roleNames: z.array(z.string().trim().min(2).max(80)).min(1).default(["client_editor"])
});

export const listInvitesQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(160).optional(),
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED"]).optional()
});

export const inviteIdParams = z.object({
  id: z.string().cuid()
});

export const acceptInviteSchema = z.object({
  token: z.string().min(32),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(120).optional()
});
