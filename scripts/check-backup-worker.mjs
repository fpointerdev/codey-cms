import path from "node:path";
import { backupControlStatus } from "./backup-control.mjs";

const status = await backupControlStatus(path.resolve(process.env.BACKUP_DIR || "backups"));
if (!status.available) process.exitCode = 1;
