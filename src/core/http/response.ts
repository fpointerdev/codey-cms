import type { Response } from "express";

export type ApiMeta = Record<string, unknown>;

export function sendSuccess<T>(
  res: Response,
  data: T,
  meta?: ApiMeta,
  statusCode = 200
) {
  const requestId = res.locals.requestId;
  const traceId = res.locals.traceId;
  const responseMeta =
    meta !== undefined || requestId || traceId
      ? {
          ...(requestId ? { requestId } : {}),
          ...(traceId ? { traceId } : {}),
          ...(meta ?? {})
        }
      : null;

  return res.status(statusCode).json({
    success: true,
    data,
    error: null,
    meta: responseMeta
  });
}

export function sendCreated<T>(res: Response, data: T, meta?: ApiMeta) {
  return sendSuccess(res, data, meta, 201);
}
