import pino from "pino";
import { config } from "../../config/index.js";

export const logger = pino({
  level: config.logging.level,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: {
    service: config.app.name,
    env: config.env,
    version: "0.1.0"
  }
});

export type AppLogger = typeof logger;
