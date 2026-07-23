import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { writeScriptAuditLog } from "./audit-log.mjs";

dotenv.config();

const prisma = new PrismaClient();

function readArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasArg(name) {
  return process.argv.some((value) => value === `--${name}` || value.startsWith(`--${name}=`));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function question(rl, label, fallback = "") {
  const suffix = fallback ? ` (${fallback})` : "";
  const answer = (await rl.question(`${label}${suffix}: `)).trim();
  return answer || fallback;
}

async function secretQuestion(label) {
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Set CODEY_ADMIN_PASSWORD when setup is not running in an interactive terminal.");
  }

  output.write(`${label}: `);
  input.resume();
  input.setRawMode(true);

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode(false);
      output.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Admin setup cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= " " && value.length < 128) value += character;
      }
    };

    input.on("data", onData);
  });
}

async function resolveInput() {
  if (hasArg("password")) {
    throw new Error("Do not pass passwords as command arguments. Use the hidden prompt or CODEY_ADMIN_PASSWORD.");
  }

  let email;
  let name;

  if (!input.isTTY) {
    email = readArg("email") || process.env.CODEY_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "";
    name = readArg("name") || process.env.CODEY_ADMIN_NAME || "Owner";
  } else {
    const rl = createInterface({ input, output });
    try {
      email = readArg("email") || await question(rl, "Admin email", process.env.CODEY_ADMIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "");
      name = readArg("name") || await question(rl, "Admin name", process.env.CODEY_ADMIN_NAME || "Owner");
    } finally {
      rl.close();
    }
  }

  const configuredPassword = process.env.CODEY_ADMIN_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
  const password = configuredPassword || await secretQuestion("Admin password");
  if (!configuredPassword) {
    const confirmation = await secretQuestion("Confirm admin password");
    if (password !== confirmation) throw new Error("Admin passwords do not match.");
  }

  if (!isValidEmail(email)) {
    throw new Error("Admin email must be a valid email address.");
  }
  if (password.length < 12 || password.length > 128) {
    throw new Error("Admin password must be between 12 and 128 characters.");
  }
  if (process.env.NODE_ENV === "production" && (
    email.toLowerCase() === "admin@example.com" || password === "ChangeMe123!"
  )) {
    throw new Error("Default administrator credentials are not allowed in production.");
  }

  return { email: email.toLowerCase(), name, password };
}

async function findExistingOwner(database = prisma) {
  return database.user.findFirst({
    where: {
      roles: {
        some: {
          role: {
            name: "owner"
          }
        }
      }
    },
    select: {
      email: true
    }
  });
}

async function ensureOwnerRole(database = prisma) {
  const permission = await database.permission.upsert({
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
  const role = await database.role.upsert({
    where: { name: "owner" },
    update: {
      description: "Site owner with full access"
    },
    create: {
      name: "owner",
      description: "Site owner with full access"
    }
  });

  await database.rolePermission.upsert({
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

  const existingOwner = await findExistingOwner();
  if (existingOwner) {
    throw new Error(`Owner setup is already complete for ${existingOwner.email}. Use account recovery instead.`);
  }

  const admin = await resolveInput();
  const passwordHash = await bcrypt.hash(admin.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    const ownerRole = await ensureOwnerRole(tx);
    const concurrentOwner = await findExistingOwner(tx);
    if (concurrentOwner) {
      throw new Error(`Owner setup is already complete for ${concurrentOwner.email}. Use account recovery instead.`);
    }

    const createdUser = await tx.user.upsert({
      where: { email: admin.email },
      update: {
        name: admin.name,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        authVersion: { increment: 1 }
      },
      create: {
        email: admin.email,
        name: admin.name,
        passwordHash,
        status: "ACTIVE",
        emailVerifiedAt: new Date()
      }
    });

    await tx.userRole.upsert({
      where: {
        userId_roleId: {
          userId: createdUser.id,
          roleId: ownerRole.id
        }
      },
      update: {},
      create: {
        userId: createdUser.id,
        roleId: ownerRole.id
      }
    });

    const revokedTokens = await tx.refreshToken.updateMany({
      where: {
        userId: createdUser.id,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    });

    await writeScriptAuditLog(tx, {
      action: "owner.bootstrap",
      subject: "user",
      subjectId: createdUser.id,
      severity: "HIGH",
      metadata: {
        email: createdUser.email,
        refreshTokensRevoked: revokedTokens.count
      }
    });

    return createdUser;
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
