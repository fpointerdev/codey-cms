import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import type { ModuleContext } from "../../core/types/module.js";

const defaultSiteSlug = "default";
const hostnamePattern =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export type SiteDomainInput = {
  hostname?: string;
  type?: "PLATFORM_SUBDOMAIN" | "CUSTOM";
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DISABLED";
  isPrimary?: boolean;
  metadata?: Record<string, unknown>;
};

export type SiteDomainUpdateInput = {
  status?: "PENDING" | "ACTIVE" | "FAILED" | "DISABLED";
  isPrimary?: boolean;
  metadata?: Record<string, unknown> | null;
};

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

function createVerificationToken() {
  return randomBytes(24).toString("base64url");
}

export class SiteDomainService {
  constructor(private readonly context: ModuleContext) {}

  async listDomains() {
    const site = await this.getOrCreateDefaultSite();

    return this.context.prisma.siteDomain.findMany({
      where: { siteId: site.id },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }]
    });
  }

  async createDomain(input: SiteDomainInput) {
    const site = await this.getOrCreateDefaultSite();
    const type = input.type ?? "CUSTOM";
    const hostname = this.resolveHostname(site.slug, type, input.hostname);
    const status = input.status ?? (type === "PLATFORM_SUBDOMAIN" ? "ACTIVE" : "PENDING");
    const verificationToken = type === "CUSTOM" ? createVerificationToken() : undefined;
    const verifiedAt = type === "PLATFORM_SUBDOMAIN" && status === "ACTIVE" ? new Date() : undefined;

    return this.context.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.siteDomain.updateMany({
          where: { siteId: site.id },
          data: { isPrimary: false }
        });
      }

      return tx.siteDomain.create({
        data: {
          siteId: site.id,
          hostname,
          type,
          status,
          isPrimary: input.isPrimary ?? false,
          verificationToken,
          verifiedAt,
          metadata: input.metadata as Prisma.InputJsonValue | undefined
        }
      });
    });
  }

  async updateDomain(domainId: string, input: SiteDomainUpdateInput) {
    const site = await this.getOrCreateDefaultSite();
    await this.assertDomainBelongsToSite(site.id, domainId);

    return this.context.prisma.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.siteDomain.updateMany({
          where: { siteId: site.id, id: { not: domainId } },
          data: { isPrimary: false }
        });
      }

      return tx.siteDomain.update({
        where: { id: domainId },
        data: {
          status: input.status,
          isPrimary: input.isPrimary,
          metadata:
            input.metadata === null
              ? Prisma.JsonNull
              : (input.metadata as Prisma.InputJsonValue | undefined)
        }
      });
    });
  }

  async refreshVerification(domainId: string) {
    const site = await this.getOrCreateDefaultSite();
    const domain = await this.assertDomainBelongsToSite(site.id, domainId);
    const now = new Date();

    if (domain.type === "PLATFORM_SUBDOMAIN") {
      this.assertPlatformHostname(domain.hostname, site.slug);

      return this.context.prisma.siteDomain.update({
        where: { id: domain.id },
        data: {
          status: "ACTIVE",
          verifiedAt: domain.verifiedAt ?? now,
          lastCheckedAt: now
        }
      });
    }

    return this.context.prisma.siteDomain.update({
      where: { id: domain.id },
      data: {
        lastCheckedAt: now,
        verificationToken: domain.verificationToken ?? createVerificationToken()
      }
    });
  }

  private async getOrCreateDefaultSite() {
    return this.context.prisma.site.upsert({
      where: {
        slug: defaultSiteSlug
      },
      update: {},
      create: {
        slug: defaultSiteSlug,
        name: this.context.config.app.name,
        deploymentProfile:
          this.context.config.app.mode === "landing" ? "presentation" : this.context.config.app.mode
      }
    });
  }

  private resolveHostname(siteSlug: string, type: SiteDomainInput["type"], hostname?: string) {
    if (type === "PLATFORM_SUBDOMAIN" && !hostname) {
      const baseDomain = this.context.config.domains.platformBaseDomain;

      if (!baseDomain) {
        throw new AppError(
          422,
          "platform_domain_not_configured",
          "PLATFORM_BASE_DOMAIN is required to create a platform subdomain."
        );
      }

      return `${siteSlug}.${baseDomain}`;
    }

    if (!hostname) {
      throw new AppError(422, "domain_hostname_required", "Domain hostname is required.");
    }

    const normalized = normalizeHostname(hostname);

    if (!hostnamePattern.test(normalized)) {
      throw new AppError(422, "invalid_domain_hostname", "Domain hostname is invalid.");
    }

    if (type === "PLATFORM_SUBDOMAIN") {
      this.assertPlatformHostname(normalized, siteSlug);
    }

    return normalized;
  }

  private assertPlatformHostname(hostname: string, siteSlug: string) {
    const baseDomain = this.context.config.domains.platformBaseDomain;

    if (!baseDomain) {
      throw new AppError(
        422,
        "platform_domain_not_configured",
        "PLATFORM_BASE_DOMAIN is required for platform subdomains."
      );
    }

    if (hostname !== `${siteSlug}.${baseDomain}`) {
      throw new AppError(
        422,
        "invalid_platform_subdomain",
        "Platform subdomain must match the configured base domain."
      );
    }
  }

  private async assertDomainBelongsToSite(siteId: string, domainId: string) {
    const domain = await this.context.prisma.siteDomain.findUnique({
      where: { id: domainId }
    });

    if (!domain || domain.siteId !== siteId) {
      throw new AppError(404, "domain_not_found", "Domain was not found.");
    }

    return domain;
  }
}
