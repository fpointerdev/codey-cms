import type { AuthenticatedUser } from "../../modules/auth/auth.types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      rawBody?: Buffer;
      traceId?: string;
      requestId?: string;
    }
  }
}

export {};
