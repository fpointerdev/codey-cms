import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";

type BackupControlStatus = {
  version: string;
  available: boolean;
  busy: boolean;
  status: string;
  requestId: string | null;
  requestedAt: string | null;
  completedAt: string | null;
  backupId: string | null;
  message: string | null;
};
type BackupControl = {
  backupControlStatus: (directory: string) => Promise<BackupControlStatus>;
  requestBackup: (directory: string) => Promise<BackupControlStatus>;
};

export class BackupControlService {
  constructor(private readonly config: AppConfig) {}

  private async control() {
    return import(pathToFileURL(path.resolve("scripts/backup-control.mjs")).href) as Promise<BackupControl>;
  }

  async status() {
    const status = await (await this.control()).backupControlStatus(this.config.backup.dir);
    return { ...status, canRequest: status.available && !status.busy && this.config.backup.encrypted };
  }

  async request() {
    if (!this.config.backup.encrypted) {
      throw new AppError(409, "backup_encryption_required", "Encrypted backups must be configured by your hosting provider first.");
    }
    try {
      return await (await this.control()).requestBackup(this.config.backup.dir);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "backup_worker_unavailable" || code === "backup_request_cooldown") {
        throw new AppError(code === "backup_worker_unavailable" ? 503 : 429, code, (error as Error).message);
      }
      throw error;
    }
  }
}
