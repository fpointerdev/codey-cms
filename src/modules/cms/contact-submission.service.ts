import type { Prisma, PrismaClient } from "@prisma/client";

type ContactSubmissionDatabase = PrismaClient | Prisma.TransactionClient;

export type ContactSubmissionInput = {
  formKey: string;
  name: string;
  email: string;
  phone?: string;
  subject?: string;
  message: string;
  metadata?: Record<string, unknown>;
  website?: string;
  startedAt?: Date;
};

export type ContactSubmissionMeta = {
  ipAddress?: string;
  userAgent?: string;
};

export function detectContactSpam(input: ContactSubmissionInput, now = new Date()) {
  if (input.website?.trim()) return "honeypot";

  if (input.startedAt) {
    const elapsedMs = now.getTime() - input.startedAt.getTime();
    if (elapsedMs >= 0 && elapsedMs < 3000) return "too_fast";
  }

  const links = input.message.match(/https?:\/\//gi) ?? [];
  if (links.length > 3) return "too_many_links";

  return null;
}

export class ContactSubmissionService {
  constructor(private readonly prisma: ContactSubmissionDatabase) {}

  async create(input: ContactSubmissionInput, meta: ContactSubmissionMeta = {}) {
    const spamReason = detectContactSpam(input);
    const submission = await this.prisma.contactSubmission.create({
      data: {
        formKey: input.formKey,
        name: input.name,
        email: input.email,
        phone: input.phone,
        subject: input.subject,
        message: input.message,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
        status: spamReason ? "SPAM" : "NEW",
        spamReason,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent
      }
    });

    return {
      received: true,
      flagged: submission.status === "SPAM"
    };
  }

  async list() {
    return this.prisma.contactSubmission.findMany({
      orderBy: {
        createdAt: "desc"
      },
      take: 100
    });
  }
}
