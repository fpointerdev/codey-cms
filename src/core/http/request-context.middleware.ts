import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

export const requestContext: RequestHandler = (req, res, next) => {
  const requestId =
    req.header("x-request-id") ?? req.header("x-correlation-id") ?? randomUUID();
  const traceparent = req.header("traceparent");
  const traceId = traceparent?.match(/^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/i)?.[1];

  req.traceId = traceId;
  res.locals.requestId = requestId;
  res.locals.traceId = traceId;
  res.setHeader("x-request-id", requestId);
  if (traceId) res.setHeader("x-trace-id", traceId);
  next();
};
