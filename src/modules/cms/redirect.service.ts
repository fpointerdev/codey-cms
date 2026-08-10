import { Prisma, type PrismaClient } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";

type RedirectDatabase = PrismaClient | Prisma.TransactionClient;

export type RedirectInput = {
  sourcePath: string;
  targetPath: string;
  statusCode: 301 | 302 | 307 | 308;
  preserveQuery: boolean;
  active: boolean;
};

export function normalizeRedirectSource(path: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || path.includes("\\")) {
    throw new AppError(422, "invalid_redirect_source", "Redirect source must be a local path.");
  }

  const parsed = new URL(path.startsWith("/") ? path : `/${path}`, "https://example.local");
  const sourcePath = parsed.pathname.replace(/\/{2,}/g, "/");
  return sourcePath === "/" ? "/" : sourcePath.replace(/\/$/g, "");
}

export function normalizeRedirectTarget(path: string) {
  if (path.startsWith("//") || path.includes("\\")) {
    throw new AppError(422, "invalid_redirect_target", "Redirect target must be a local path or an HTTP URL.");
  }
  if (/^https?:\/\//i.test(path)) return new URL(path).toString();
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    throw new AppError(422, "invalid_redirect_target", "Redirect target must be a local path or an HTTP URL.");
  }

  const parsed = new URL(path.startsWith("/") ? path : `/${path}`, "https://example.local");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function appendRedirectQuery(targetPath: string, search: string) {
  const external = /^https?:\/\//i.test(targetPath);
  const target = new URL(targetPath, "https://example.local");
  const incoming = new URLSearchParams(search);
  for (const [key, value] of incoming) target.searchParams.append(key, value);

  return external ? target.toString() : `${target.pathname}${target.search}${target.hash}`;
}

function assertRedirectDoesNotLoop(sourcePath: string, targetPath: string) {
  if (/^https?:\/\//i.test(targetPath)) return;
  if (normalizeRedirectSource(sourcePath) === normalizeRedirectSource(targetPath)) {
    throw new AppError(422, "redirect_loop", "Redirect source and target must be different.");
  }
}

export class RedirectService {
  constructor(private readonly prisma: RedirectDatabase) {}

  async list() {
    return this.prisma.cmsRedirect.findMany({
      orderBy: { createdAt: "desc" }
    });
  }

  async create(input: RedirectInput) {
    const sourcePath = normalizeRedirectSource(input.sourcePath);
    const targetPath = normalizeRedirectTarget(input.targetPath);
    assertRedirectDoesNotLoop(sourcePath, targetPath);
    if (input.active) await this.assertChainDoesNotLoop(sourcePath, targetPath);

    return this.prisma.cmsRedirect.create({
      data: {
        ...input,
        sourcePath,
        targetPath
      }
    });
  }

  async update(redirectId: string, input: Partial<RedirectInput>) {
    const current = await this.prisma.cmsRedirect.findUniqueOrThrow({
      where: { id: redirectId }
    });
    const sourcePath = input.sourcePath
      ? normalizeRedirectSource(input.sourcePath)
      : current.sourcePath;
    const targetPath = input.targetPath
      ? normalizeRedirectTarget(input.targetPath)
      : current.targetPath;
    assertRedirectDoesNotLoop(sourcePath, targetPath);
    if (input.active ?? current.active) {
      await this.assertChainDoesNotLoop(sourcePath, targetPath, redirectId);
    }

    return this.prisma.cmsRedirect.update({
      where: { id: redirectId },
      data: {
        ...input,
        sourcePath,
        targetPath
      }
    });
  }

  async delete(redirectId: string) {
    await this.prisma.cmsRedirect.delete({
      where: { id: redirectId }
    });
  }

  async resolve(path: string) {
    const parsed = new URL(path, "https://example.local");
    let redirect;

    try {
      redirect = await this.prisma.cmsRedirect.findFirst({
        where: {
          sourcePath: normalizeRedirectSource(path),
          active: true
        }
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return null;
      throw error;
    }

    if (!redirect) return null;
    const targetPath = redirect.preserveQuery && parsed.search
      ? appendRedirectQuery(redirect.targetPath, parsed.search)
      : redirect.targetPath;

    return {
      ...redirect,
      targetPath
    };
  }

  private async assertChainDoesNotLoop(sourcePath: string, targetPath: string, excludedId?: string) {
    if (/^https?:\/\//i.test(targetPath)) return;

    const visited = new Set([sourcePath]);
    let currentPath = normalizeRedirectSource(targetPath);
    for (let depth = 0; depth < 50; depth += 1) {
      if (visited.has(currentPath)) {
        throw new AppError(422, "redirect_loop", "Redirect would create a loop.");
      }
      visited.add(currentPath);

      const redirect = await this.prisma.cmsRedirect.findFirst({
        where: {
          sourcePath: currentPath,
          active: true,
          ...(excludedId ? { id: { not: excludedId } } : {})
        },
        select: { targetPath: true }
      });
      if (!redirect || /^https?:\/\//i.test(redirect.targetPath)) return;
      currentPath = normalizeRedirectSource(redirect.targetPath);
    }

    throw new AppError(422, "redirect_chain_too_deep", "Redirect chain is too long.");
  }
}
