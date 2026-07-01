import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function question(rl, label, fallback = "") {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function resolveInput() {
  const rl = createInterface({ input, output });

  try {
    const email = readArg("email") || await question(rl, "Admin email", process.env.CODEY_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "");
    const name = readArg("name") || await question(rl, "Admin name", process.env.CODEY_ADMIN_NAME || "Owner");
    const password = readArg("password") || await question(rl, "Admin password", process.env.CODEY_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD || "");

    if (!isValidEmail(email)) {
      throw new Error("Admin email must be a valid email address.");
    }

    if (password.length < 8) {
      throw new Error("Admin password must be at least 8 characters.");
    }

    return { email: email.toLowerCase(), name, password };
  } finally {
    rl.close();
  }
}

async function ensureOwnerRole() {
  const permission = await prisma.permission.upsert({
    where: {
      action_subject: {
        action: "manage",
        subject: "all"
      }
    },
    update: {
      description: "Full administrative access"
    },
    create: {
      action: "manage",
      subject: "all",
      description: "Full administrative access"
    }
  });
  const role = await prisma.role.upsert({
    where: { name: "owner" },
    update: {
      description: "Site owner with full access"
    },
    create: {
      name: "owner",
      description: "Site owner with full access"
    }
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: permission.id
      }
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: permission.id
    }
  });

  return role;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure it first.");
  }

  const admin = await resolveInput();
  const ownerRole = await ensureOwnerRole();
  const passwordHash = await bcrypt.hash(admin.password, 12);
  const user = await prisma.user.upsert({
    where: { email: admin.email },
    update: {
      name: admin.name,
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date()
    },
    create: {
      email: admin.email,
      name: admin.name,
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date()
    }
  });

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

  console.log(`Admin user ready: ${user.email}`);
  console.log("Open /cy-admin or /dashboard and sign in with this account.");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error.message || error);
    await prisma.$disconnect();
    process.exit(1);
  });
