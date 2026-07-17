import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/core/security/password.js";
import { deploymentProfiles, type DeploymentProfileId } from "../src/modules/manifest.js";

const prisma = new PrismaClient();
const email = (process.env.INTEGRATION_ADMIN_EMAIL || "integration-owner@example.com").trim().toLowerCase();
const password = process.env.INTEGRATION_ADMIN_PASSWORD || "IntegrationOwner123!";

function testProfileId(): DeploymentProfileId {
  const mode = process.env.APP_MODE || "shop";
  if (mode === "landing") return "presentation";
  return mode in deploymentProfiles ? mode as DeploymentProfileId : "shop";
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("INTEGRATION_ADMIN_EMAIL must be a valid email address.");
}
if (password.length < 12 || password.length > 128) {
  throw new Error("INTEGRATION_ADMIN_PASSWORD must be between 12 and 128 characters.");
}

try {
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: "owner" } });
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: "Integration Owner",
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      authVersion: { increment: 1 }
    },
    create: {
      email,
      name: "Integration Owner",
      passwordHash: await hashPassword(password),
      status: "ACTIVE",
      emailVerifiedAt: new Date()
    }
  });

  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: ownerRole.id
      }
    },
    update: {},
    create: {
      userId: user.id,
      roleId: ownerRole.id
    }
  });

  const enabledModules = deploymentProfiles[testProfileId()].modules;
  await prisma.installedModule.updateMany({
    where: { site: { slug: "default" } },
    data: { status: "DISABLED" }
  });
  await prisma.installedModule.updateMany({
    where: {
      site: { slug: "default" },
      moduleId: { in: [...enabledModules] }
    },
    data: { status: "ENABLED" }
  });
} finally {
  await prisma.$disconnect();
}
