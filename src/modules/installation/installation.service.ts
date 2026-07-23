import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import { writeAuditLog } from "../../core/audit/audit-log.js";
import { hashPassword } from "../../core/security/password.js";
import {
  runtimeReleaseChannel,
  runtimeVersion
} from "../../runtime/release.js";
import {
  deploymentProfiles,
  moduleCatalog,
  type DeploymentProfileId
} from "../manifest.js";
import type { CompleteInstallationInput } from "./installation.schemas.js";

const installationId = "primary";
const roleDescriptions: Record<string, string> = {
  owner: "Site owner with full access",
  admin: "System administrator with full access",
  designer: "Designer/editor access for content and catalog work",
  client_editor: "Client editor access for day-to-day content updates",
  visitor: "Public visitor preset with no privileged permissions",
  user: "Default authenticated user"
};
const rolePermissionKeys: Record<string, Array<[string, string]>> = {
  owner: [["manage", "all"]],
  admin: [["manage", "all"]],
  designer: [
    ["read", "modules"],
    ["read", "cms"],
    ["create", "cms"],
    ["update", "cms"],
    ["read", "products"],
    ["create", "products"],
    ["update", "products"],
    ["read", "orders"]
  ],
  client_editor: [
    ["read", "cms"],
    ["create", "cms"],
    ["update", "cms"],
    ["read", "products"],
    ["update", "products"]
  ],
  visitor: [],
  user: []
};

type RequestMeta = {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
};

export class InstallationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig
  ) {}

  async status() {
    const [installation, owner] = await Promise.all([
      this.prisma.runtimeInstallation.findUnique({ where: { id: installationId } }),
      this.findOwner(this.prisma)
    ]);

    if (installation?.status === "COMPLETE") {
      return this.publicStatus(true, installation.runtimeVersion, Boolean(owner));
    }

    if (owner) {
      const site = await this.prisma.site.findUnique({ where: { slug: "default" } });
      await this.prisma.runtimeInstallation.upsert({
        where: { id: installationId },
        update: {
          status: "COMPLETE",
          siteId: site?.id,
          ownerUserId: owner.id,
          completedAt: installation?.completedAt ?? new Date()
        },
        create: {
          id: installationId,
          status: "COMPLETE",
          runtimeVersion,
          releaseChannel: runtimeReleaseChannel,
          siteId: site?.id,
          ownerUserId: owner.id,
          completedAt: new Date(),
          metadata: { source: "existing-owner-reconciliation" }
        }
      });

      return this.publicStatus(true, installation?.runtimeVersion ?? runtimeVersion, true);
    }

    return this.publicStatus(false, runtimeVersion, false);
  }

  async complete(input: CompleteInstallationInput, meta: RequestMeta) {
    this.assertClaimToken(input.claimToken);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const installation = await tx.runtimeInstallation.upsert({
          where: { id: installationId },
          update: {},
          create: {
            id: installationId,
            status: "PENDING",
            runtimeVersion,
            releaseChannel: runtimeReleaseChannel
          }
        });
        const existingOwner = await this.findOwner(tx);

        if (installation.status === "COMPLETE" || existingOwner) {
          throw new AppError(409, "installation_complete", "CodeY CMS is already installed.");
        }
        if (await tx.user.count() > 0) {
          throw new AppError(
            409,
            "installation_existing_users",
            "Setup cannot continue because user accounts already exist. Use the recovery setup command."
          );
        }

        const profile = deploymentProfiles[input.profile];
        const site = await tx.site.upsert({
          where: { slug: "default" },
          update: {
            name: input.siteName,
            deploymentProfile: profile.id
          },
          create: {
            slug: "default",
            name: input.siteName,
            deploymentProfile: profile.id
          }
        });
        const roles = await this.initializeAccess(tx);
        await this.initializeModules(tx, site.id, profile.id);
        await this.initializeSiteSettings(tx, site.id, input);
        await this.initializeHomePage(tx, input.siteName);

        const owner = await tx.user.create({
          data: {
            email: input.admin.email.toLowerCase(),
            name: input.admin.name,
            passwordHash: await hashPassword(input.admin.password),
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
            roles: {
              create: { roleId: roles.owner }
            }
          }
        });
        const completedAt = new Date();

        await tx.runtimeInstallation.update({
          where: { id: installationId },
          data: {
            status: "COMPLETE",
            runtimeVersion,
            releaseChannel: runtimeReleaseChannel,
            siteId: site.id,
            ownerUserId: owner.id,
            completedAt,
            metadata: {
              source: "browser-installer",
              profile: profile.id
            }
          }
        });
        await writeAuditLog(tx, {
          actorUserId: owner.id,
          action: "runtime.install",
          subject: "runtime",
          subjectId: installationId,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
          severity: "HIGH",
          metadata: {
            runtimeVersion,
            profile: profile.id,
            siteId: site.id
          }
        });

        return {
          installed: true,
          runtimeVersion,
          profile: profile.id,
          site: { id: site.id, name: site.name },
          owner: { id: owner.id, email: owner.email, name: owner.name },
          completedAt: completedAt.toISOString()
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
        throw new AppError(409, "installation_in_progress", "Another installation request completed first. Refresh setup status.");
      }
      throw error;
    }
  }

  private publicStatus(installed: boolean, installedVersion: string, ownerAvailable: boolean) {
    return {
      installed,
      runtimeVersion: installedVersion,
      channel: runtimeReleaseChannel,
      ownerAvailable,
      recoveryRequired: installed && !ownerAvailable,
      claimTokenRequired: Boolean(this.config.installation.claimToken),
      defaultProfile: this.defaultProfile(),
      publicUrl: this.config.app.publicUrl,
      requirements: {
        database: "PostgreSQL 16+",
        storage: this.config.storage.driver,
        migrations: "ready"
      }
    };
  }

  private assertClaimToken(providedToken: string) {
    const expectedToken = this.config.installation.claimToken;
    if (!expectedToken) {
      if (this.config.isProduction) {
        throw new AppError(503, "installation_token_missing", "The server installation token is not configured.");
      }
      return;
    }

    const expectedHash = createHash("sha256").update(expectedToken).digest();
    const providedHash = createHash("sha256").update(providedToken).digest();
    if (!timingSafeEqual(expectedHash, providedHash)) {
      throw new AppError(403, "installation_token_invalid", "The installation claim token is invalid.");
    }
  }

  private defaultProfile(): DeploymentProfileId {
    if (this.config.app.mode === "landing") return "presentation";
    if (["presentation", "cms", "shop"].includes(this.config.app.mode)) {
      return this.config.app.mode as DeploymentProfileId;
    }
    return "cms";
  }

  private findOwner(database: PrismaClient | Prisma.TransactionClient) {
    return database.user.findFirst({
      where: {
        roles: {
          some: { role: { name: "owner" } }
        }
      },
      select: { id: true }
    });
  }

  private async initializeAccess(tx: Prisma.TransactionClient) {
    const definitions = [
      { action: "manage", subject: "all", description: "Full administrative access" },
      ...Object.values(moduleCatalog).flatMap((module) => module.permissions)
    ];
    const uniqueDefinitions = new Map(
      definitions.map((permission) => [`${permission.action}:${permission.subject}`, permission])
    );

    for (const permission of uniqueDefinitions.values()) {
      await tx.permission.upsert({
        where: {
          action_subject: {
            action: permission.action,
            subject: permission.subject
          }
        },
        update: { description: permission.description },
        create: permission
      });
    }

    const roleIds: Record<string, string> = {};
    for (const [name, permissionKeys] of Object.entries(rolePermissionKeys)) {
      const role = await tx.role.upsert({
        where: { name },
        update: { description: roleDescriptions[name] },
        create: { name, description: roleDescriptions[name] }
      });
      const permissions = permissionKeys.length
        ? await tx.permission.findMany({
            where: {
              OR: permissionKeys.map(([action, subject]) => ({ action, subject }))
            },
            select: { id: true }
          })
        : [];

      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId: role.id,
            permissionId: permission.id
          })),
          skipDuplicates: true
        });
      }
      roleIds[name] = role.id;
    }

    return roleIds;
  }

  private async initializeModules(
    tx: Prisma.TransactionClient,
    siteId: string,
    profileId: DeploymentProfileId
  ) {
    const enabledModules = new Set(deploymentProfiles[profileId].modules);

    for (const module of Object.values(moduleCatalog)) {
      await tx.installedModule.upsert({
        where: {
          siteId_moduleId: { siteId, moduleId: module.id }
        },
        update: {
          status: enabledModules.has(module.id) ? "ENABLED" : "DISABLED",
          version: module.version,
          monthlyEuroCents: 0
        },
        create: {
          siteId,
          moduleId: module.id,
          status: enabledModules.has(module.id) ? "ENABLED" : "DISABLED",
          version: module.version,
          monthlyEuroCents: 0
        }
      });
    }
  }

  private async initializeSiteSettings(
    tx: Prisma.TransactionClient,
    siteId: string,
    input: CompleteInstallationInput
  ) {
    const key = { siteId, moduleId: "config", key: "site" };
    const existing = await tx.moduleSetting.findUnique({
      where: { siteId_moduleId_key: key },
      select: { value: true }
    });
    const stored = existing?.value && typeof existing.value === "object" && !Array.isArray(existing.value)
      ? existing.value as Record<string, unknown>
      : {};
    const value = {
      ...stored,
      title: input.siteName,
      metaTitle: input.siteName,
      siteUrl: this.config.app.publicUrl,
      searchIndexing: input.searchIndexing
    };

    return tx.moduleSetting.upsert({
      where: {
        siteId_moduleId_key: key
      },
      update: {
        value: value as Prisma.InputJsonValue
      },
      create: {
        siteId,
        moduleId: "config",
        key: "site",
        value: value as Prisma.InputJsonValue
      }
    });
  }

  private async initializeHomePage(tx: Prisma.TransactionClient, siteName: string) {
    const page = await tx.cmsPage.upsert({
      where: {
        locale_slug: { locale: "en", slug: "home" }
      },
      update: {},
      create: {
        title: "Home",
        slug: "home",
        locale: "en",
        translationGroupId: "home",
        excerpt: `Welcome to ${siteName}.`,
        content: { layout: "full-width", hideTitle: true },
        metaTitle: siteName,
        status: "PUBLISHED",
        publishedAt: new Date()
      }
    });
    const section = await tx.pageSection.upsert({
      where: {
        pageId_key: { pageId: page.id, key: "welcome" }
      },
      update: {},
      create: {
        pageId: page.id,
        key: "welcome",
        label: "Welcome",
        settings: {
          elementId: "hero-creative",
          layout: "full-width",
          container: "content"
        }
      }
    });
    await tx.contentBlock.upsert({
      where: {
        pageId_key: { pageId: page.id, key: "welcome-copy" }
      },
      update: {},
      create: {
        pageId: page.id,
        sectionId: section.id,
        type: "RICH_TEXT",
        key: "welcome-copy",
        label: "Welcome copy",
        value: `<h1>${escapeHtml(siteName)}</h1><p>Your website is ready to edit.</p>`,
        settings: {},
        editable: true
      }
    });
    const menu = await tx.menu.upsert({
      where: {
        locale_slug: { locale: "en", slug: "main" }
      },
      update: { name: "Main", location: "header" },
      create: {
        slug: "main",
        locale: "en",
        name: "Main",
        location: "header"
      }
    });
    const existingItem = await tx.menuItem.findFirst({
      where: { menuId: menu.id, pageId: page.id }
    });
    if (!existingItem) {
      await tx.menuItem.create({
        data: {
          menuId: menu.id,
          pageId: page.id,
          label: "Home",
          sortOrder: 0
        }
      });
    }
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
