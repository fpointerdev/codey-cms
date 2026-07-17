import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, stat, unlink, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const magic = Buffer.from("CODEYBK1", "ascii");
const saltLength = 16;
const ivLength = 12;
const authTagLength = 16;
const headerLength = magic.length + saltLength + ivLength;

function keyFromSecret(secret, salt) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Backup encryption key must contain at least 32 characters.");
  }

  return scryptSync(secret, salt, 32);
}

export async function encryptBackupFile(inputFile, outputFile, secret) {
  const salt = randomBytes(saltLength);
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret, salt), iv);

  await writeFile(outputFile, Buffer.concat([magic, salt, iv]), { mode: 0o600 });
  try {
    await pipeline(
      createReadStream(inputFile),
      cipher,
      createWriteStream(outputFile, { flags: "a", mode: 0o600 })
    );
    await appendFile(outputFile, cipher.getAuthTag());
  } catch (error) {
    await unlink(outputFile).catch(() => undefined);
    throw error;
  }
}

export async function decryptBackupFile(inputFile, outputFile, secret) {
  const fileStats = await stat(inputFile);
  if (fileStats.size <= headerLength + authTagLength) {
    throw new Error("Encrypted backup file is truncated.");
  }

  const file = await open(inputFile, "r");
  try {
    const header = Buffer.alloc(headerLength);
    const authTag = Buffer.alloc(authTagLength);
    await file.read(header, 0, header.length, 0);
    await file.read(authTag, 0, authTag.length, fileStats.size - authTagLength);

    if (!header.subarray(0, magic.length).equals(magic)) {
      throw new Error("Backup file is not a CodeY encrypted archive.");
    }

    const salt = header.subarray(magic.length, magic.length + saltLength);
    const iv = header.subarray(magic.length + saltLength, headerLength);
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret, salt), iv);
    decipher.setAuthTag(authTag);

    try {
      await pipeline(
        createReadStream(inputFile, {
          start: headerLength,
          end: fileStats.size - authTagLength - 1
        }),
        decipher,
        createWriteStream(outputFile, { mode: 0o600 })
      );
    } catch (error) {
      await unlink(outputFile).catch(() => undefined);
      throw new Error("Encrypted backup could not be authenticated. Check the backup key and file integrity.", {
        cause: error
      });
    }
  } finally {
    await file.close();
  }
}

export async function isEncryptedBackupFile(inputFile) {
  const file = await open(inputFile, "r");
  try {
    const prefix = Buffer.alloc(magic.length);
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    return bytesRead === magic.length && prefix.equals(magic);
  } finally {
    await file.close();
  }
}
