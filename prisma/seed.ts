import { PrismaClient } from "@prisma/client";
import { shouldSeedDemoContent } from "../src/core/seed-policy.js";
import { hashPassword } from "../src/core/security/password.js";
import {
  deploymentProfiles,
  moduleCatalog,
  type DeploymentProfileId
} from "../src/modules/manifest.js";

const prisma = new PrismaClient();

function resolveDeploymentProfileId(): DeploymentProfileId {
  const mode = process.env.APP_MODE ?? "shop";

  if (mode === "landing") return "presentation";
  if (mode in deploymentProfiles) return mode as DeploymentProfileId;

  return "shop";
}

const permissions = [
  {
    action: "manage",
    subject: "all",
    description: "Full administrative access"
  },
  ...Object.values(moduleCatalog).flatMap((module) => module.permissions)
];

const roleDescriptions: Record<string, string> = {
  owner: "Site owner with full access",
  admin: "System administrator with full access",
  designer: "Designer/editor access for content and catalog work",
  client_editor: "Client editor access for day-to-day content updates",
  visitor: "Public visitor preset with no privileged permissions",
  user: "Default authenticated user"
};

async function upsertPermissions() {
  for (const { action, subject, description } of permissions) {
    await prisma.permission.upsert({
      where: {
        action_subject: {
          action,
          subject
        }
      },
      update: { description },
      create: { action, subject, description }
    });
  }
}

async function syncRolePermissions(roleName: string, permissionKeys: Array<[string, string]>) {
  const role = await prisma.role.upsert({
    where: { name: roleName },
    update: {
      description: roleDescriptions[roleName] ?? "Custom role"
    },
    create: {
      name: roleName,
      description: roleDescriptions[roleName] ?? "Custom role"
    }
  });

  const existingPermissions = await prisma.permission.findMany({
    where: {
      OR: permissionKeys.map(([action, subject]) => ({ action, subject }))
    }
  });

  await prisma.rolePermission.deleteMany({
    where: { roleId: role.id }
  });

  await prisma.rolePermission.createMany({
    data: existingPermissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id
    })),
    skipDuplicates: true
  });

  return role;
}

function readAdminBootstrapInput() {
  const email = (process.env.CODEY_ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.CODEY_ADMIN_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "";
  const name = (process.env.CODEY_ADMIN_NAME ?? "Owner").trim() || "Owner";

  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error("CODEY_ADMIN_EMAIL and CODEY_ADMIN_PASSWORD must both be set to bootstrap an owner.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("CODEY_ADMIN_EMAIL must be a valid email address.");
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error("CODEY_ADMIN_PASSWORD must be between 12 and 128 characters.");
  }
  if (process.env.NODE_ENV === "production" && (
    email === "admin@example.com" || password === "ChangeMe123!"
  )) {
    throw new Error("Default administrator credentials are not allowed in production.");
  }

  return { email, password, name };
}

async function seedAdminUser(adminRoleId: string) {
  const admin = readAdminBootstrapInput();
  if (!admin) {
    console.log("Owner bootstrap skipped. Run `pnpm setup:admin` once after deployment.");
    return;
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: admin.email },
    select: {
      roles: {
        where: { roleId: adminRoleId },
        select: { roleId: true }
      }
    }
  });

  if (existingUser) {
    if (existingUser.roles.length > 0) return;
    throw new Error(
      "CODEY_ADMIN_EMAIL belongs to an existing non-owner account. Run `pnpm setup:admin` to promote it securely."
    );
  }

  await prisma.user.create({
    data: {
      email: admin.email,
      name: admin.name,
      passwordHash: await hashPassword(admin.password),
      emailVerifiedAt: new Date(),
      roles: {
        create: {
          roleId: adminRoleId
        }
      }
    }
  });
}

async function seedProducts() {
  const site = await prisma.site.findUniqueOrThrow({ where: { slug: "default" } });
  const imageUrl = "https://placehold.co/1200x800/png";
  const existingImageAsset = await prisma.mediaAsset.findFirst({
    where: { siteId: site.id, url: imageUrl, deletedAt: null }
  });
  const imageAsset = existingImageAsset
    ? await prisma.mediaAsset.update({
        where: { id: existingImageAsset.id },
        data: {
          kind: "IMAGE",
          mimeType: "image/png",
          width: 1200,
          height: 800,
          altText: "Starter product image"
        }
      })
    : await prisma.mediaAsset.create({
        data: {
          siteId: site.id,
          kind: "IMAGE",
          url: imageUrl,
          mimeType: "image/png",
          width: 1200,
          height: 800,
          altText: "Starter product image"
        }
      });
  const category = await prisma.productCategory.upsert({
    where: {
      locale_slug: {
        locale: "en",
        slug: "starter-products"
      }
    },
    update: {},
    create: {
      name: "Starter Products",
      slug: "starter-products",
      locale: "en",
      translationGroupId: "starter-products",
      description: "Demo category for shop mode"
    }
  });

  const product = await prisma.product.upsert({
    where: {
      locale_slug: {
        locale: "en",
        slug: "starter-product"
      }
    },
    update: {},
    create: {
      name: "Starter Product",
      slug: "starter-product",
      locale: "en",
      translationGroupId: "starter-product",
      description: "Replace this product with real catalog data.",
      priceCents: 9900,
      currency: "USD",
      stockQuantity: 10,
      status: "ACTIVE",
      categoryId: category.id
    }
  });
  await prisma.productOption.upsert({
    where: {
      productId_name: {
        productId: product.id,
        name: "Size"
      }
    },
    update: {
      values: ["Standard"],
      sortOrder: 0
    },
    create: {
      productId: product.id,
      name: "Size",
      values: ["Standard"],
      sortOrder: 0
    }
  });
  await prisma.productVariant.upsert({
    where: { sku: "STARTER-STANDARD" },
    update: {
      name: "Standard",
      optionValues: {
        Size: "Standard"
      },
      priceCents: 9900,
      stockQuantity: 10,
      active: true
    },
    create: {
      productId: product.id,
      name: "Standard",
      sku: "STARTER-STANDARD",
      optionValues: {
        Size: "Standard"
      },
      priceCents: 9900,
      stockQuantity: 10,
      active: true
    }
  });

  const productImage = await prisma.productImage.findFirst({
    where: {
      productId: product.id,
      url: imageUrl
    }
  });

  if (productImage) {
    await prisma.productImage.update({
      where: { id: productImage.id },
      data: {
        mediaAssetId: imageAsset.id,
        alt: "Starter product image",
        sortOrder: 0,
        isPrimary: true
      }
    });
  } else {
    await prisma.productImage.create({
      data: {
        productId: product.id,
        mediaAssetId: imageAsset.id,
        url: imageUrl,
        alt: "Starter product image",
        sortOrder: 0,
        isPrimary: true
      }
    });
  }
}

async function seedShopConfig() {
  let zone = await prisma.shippingZone.findFirst({
    where: { name: "Worldwide" }
  });

  if (zone) {
    zone = await prisma.shippingZone.update({
      where: { id: zone.id },
      data: {
        countries: [],
        active: true
      }
    });
  } else {
    zone = await prisma.shippingZone.create({
      data: {
        name: "Worldwide",
        countries: [],
        active: true
      }
    });
  }

  const rate = await prisma.shippingRate.findFirst({
    where: {
      zoneId: zone.id,
      name: "Standard shipping"
    }
  });

  if (rate) {
    await prisma.shippingRate.update({
      where: { id: rate.id },
      data: {
        minSubtotalCents: 0,
        priceCents: 500,
        active: true,
        sortOrder: 0
      }
    });
  } else {
    await prisma.shippingRate.create({
      data: {
        zoneId: zone.id,
        name: "Standard shipping",
        minSubtotalCents: 0,
        priceCents: 500,
        active: true,
        sortOrder: 0
      }
    });
  }

  const taxRule = await prisma.taxRule.findFirst({
    where: { name: "Default tax" }
  });

  if (taxRule) {
    await prisma.taxRule.update({
      where: { id: taxRule.id },
      data: {
        country: null,
        region: null,
        rateBps: 0,
        active: true,
        priority: 0
      }
    });
  } else {
    await prisma.taxRule.create({
      data: {
        name: "Default tax",
        rateBps: 0,
        active: true,
        priority: 0
      }
    });
  }

  await prisma.coupon.upsert({
    where: { code: "WELCOME10" },
    update: {
      description: "Starter 10% discount coupon",
      discountType: "PERCENTAGE",
      amount: 10,
      active: true
    },
    create: {
      code: "WELCOME10",
      description: "Starter 10% discount coupon",
      discountType: "PERCENTAGE",
      amount: 10,
      active: true
    }
  });
}

async function seedCmsContent(includeDemoContent: boolean) {
  const page = await prisma.cmsPage.upsert({
    where: {
      locale_slug: {
        locale: "en",
        slug: "home"
      }
    },
    update: {},
    create: {
      title: "Home",
      slug: "home",
      locale: "en",
      translationGroupId: "home",
      excerpt: "A starter page ready for inline editing.",
      content: {},
      metaTitle: "Home",
      metaDescription: "Starter CMS home page",
      status: "PUBLISHED",
      publishedAt: new Date()
    }
  });
  const heroSection = await prisma.pageSection.upsert({
    where: {
      pageId_key: {
        pageId: page.id,
        key: "hero"
      }
    },
    update: {
      label: "Hero",
      sortOrder: 0,
      settings: {}
    },
    create: {
      pageId: page.id,
      key: "hero",
      label: "Hero",
      sortOrder: 0,
      settings: {}
    }
  });

  await prisma.contentBlock.upsert({
    where: {
      pageId_key: {
        pageId: page.id,
        key: "hero-copy"
      }
    },
    update: {
      type: "RICH_TEXT",
      label: "Hero copy",
      value: "Start editing this page directly from the website.",
      sortOrder: 0,
      editable: true,
      sectionId: heroSection.id
    },
    create: {
      pageId: page.id,
      sectionId: heroSection.id,
      type: "RICH_TEXT",
      key: "hero-copy",
      label: "Hero copy",
      value: "Start editing this page directly from the website.",
      sortOrder: 0,
      editable: true
    }
  });

  const menu = await prisma.menu.upsert({
    where: {
      locale_slug: {
        locale: "en",
        slug: "main"
      }
    },
    update: {
      name: "Main",
      location: "header"
    },
    create: {
      slug: "main",
      locale: "en",
      name: "Main",
      location: "header"
    }
  });
  const existingMenuItem = await prisma.menuItem.findFirst({
    where: {
      menuId: menu.id,
      pageId: page.id
    }
  });

  if (existingMenuItem) {
    await prisma.menuItem.update({
      where: { id: existingMenuItem.id },
      data: {
        label: "Home",
        sortOrder: 0
      }
    });
  } else {
    await prisma.menuItem.create({
      data: {
        menuId: menu.id,
        pageId: page.id,
        label: "Home",
        sortOrder: 0
      }
    });
  }

  if (!includeDemoContent) return;

  const category = await prisma.cmsCategory.upsert({
    where: {
      locale_slug: {
        locale: "en",
        slug: "news"
      }
    },
    update: {
      name: "News",
      description: "Starter CMS article category"
    },
    create: {
      name: "News",
      slug: "news",
      locale: "en",
      translationGroupId: "news",
      description: "Starter CMS article category"
    }
  });
  const post = await prisma.cmsPost.upsert({
    where: {
      locale_slug: {
        locale: "en",
        slug: "welcome-article"
      }
    },
    update: {
      title: "Welcome article",
      excerpt: "A starter article for the CMS module.",
      content: {
        body: "Replace this article with real content."
      },
      status: "PUBLISHED",
      publishedAt: new Date(),
      tags: ["starter"]
    },
    create: {
      title: "Welcome article",
      slug: "welcome-article",
      locale: "en",
      translationGroupId: "welcome-article",
      excerpt: "A starter article for the CMS module.",
      content: {
        body: "Replace this article with real content."
      },
      status: "PUBLISHED",
      publishedAt: new Date(),
      tags: ["starter"]
    }
  });

  await prisma.cmsPostCategory.upsert({
    where: {
      postId_categoryId: {
        postId: post.id,
        categoryId: category.id
      }
    },
    update: {},
    create: {
      postId: post.id,
      categoryId: category.id
    }
  });
}

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

async function seedSiteModules() {
  const profileId = resolveDeploymentProfileId();
  const profile = deploymentProfiles[profileId];
  const site = await prisma.site.upsert({
    where: { slug: "default" },
    update: {
      name: process.env.APP_NAME ?? "Modular Production Starter",
      deploymentProfile: profile.id
    },
    create: {
      slug: "default",
      name: process.env.APP_NAME ?? "Modular Production Starter",
      deploymentProfile: profile.id
    }
  });
  const enabledModules = new Set(profile.modules);

  for (const module of Object.values(moduleCatalog)) {
    await prisma.installedModule.upsert({
      where: {
        siteId_moduleId: {
          siteId: site.id,
          moduleId: module.id
        }
      },
      update: {
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      },
      create: {
        siteId: site.id,
        moduleId: module.id,
        status: enabledModules.has(module.id) ? "ENABLED" : "DISABLED",
        version: module.version,
        monthlyEuroCents: module.monthlyEuroCents
      }
    });
  }

  const platformBaseDomain = process.env.PLATFORM_BASE_DOMAIN
    ? normalizeHostname(process.env.PLATFORM_BASE_DOMAIN)
    : undefined;

  if (platformBaseDomain) {
    const hostname = `${site.slug}.${platformBaseDomain}`;
    const verifiedAt = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.siteDomain.updateMany({
        where: {
          siteId: site.id,
          hostname: { not: hostname }
        },
        data: {
          isPrimary: false
        }
      });

      await tx.siteDomain.upsert({
        where: {
          hostname
        },
        update: {
          type: "PLATFORM_SUBDOMAIN",
          status: "ACTIVE",
          isPrimary: true,
          verifiedAt
        },
        create: {
          siteId: site.id,
          hostname,
          type: "PLATFORM_SUBDOMAIN",
          status: "ACTIVE",
          isPrimary: true,
          verifiedAt
        }
      });
    });
  }
}

async function main() {
  const profile = deploymentProfiles[resolveDeploymentProfileId()];
  const includeDemoContent = shouldSeedDemoContent();

  await upsertPermissions();

  const ownerRole = await syncRolePermissions("owner", [["manage", "all"]]);
  await syncRolePermissions("admin", [["manage", "all"]]);
  await syncRolePermissions("designer", [
    ["read", "modules"],
    ["read", "cms"],
    ["create", "cms"],
    ["update", "cms"],
    ["read", "products"],
    ["create", "products"],
    ["update", "products"],
    ["read", "orders"]
  ]);
  await syncRolePermissions("client_editor", [
    ["read", "cms"],
    ["create", "cms"],
    ["update", "cms"],
    ["read", "products"],
    ["update", "products"]
  ]);
  await syncRolePermissions("visitor", []);
  await syncRolePermissions("user", []);
  await seedAdminUser(ownerRole.id);
  await seedSiteModules();

  if (includeDemoContent && profile.modules.includes("products")) {
    await seedProducts();
  }

  if (includeDemoContent && profile.modules.includes("orders")) {
    await seedShopConfig();
  }

  if (profile.modules.includes("cms")) {
    await seedCmsContent(includeDemoContent);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
