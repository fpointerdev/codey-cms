import pino from "pino";
import { config } from "../../config/index.js";

export const logger = pino({
  level: config.logging.level,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    censor: "[Redacted]",
    paths: [
      "authorization",
      "cookie",
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "clientSecret",
      "secretAccessKey",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.clientSecret",
      "*.secretAccessKey",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers[\"x-api-key\"]",
      "res.headers[\"set-cookie\"]"
    ]
  },
  base: {
    service: config.app.name,
    env: config.env,
    version: "0.1.0"
  }
});

export type AppLogger = typeof logger;
