import type { IncomingMessage, ServerResponse } from "node:http";

const sensitiveQueryKey = /(?:^|_)(?:authorization|code|key|password|secret|signature|token)(?:$|_)/i;

export function safeRequestUrl(value = "") {
  try {
    const url = new URL(value, "http://localhost");

    for (const key of url.searchParams.keys()) {
      if (sensitiveQueryKey.test(key)) url.searchParams.set(key, "[Redacted]");
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return String(value || "").split("?")[0];
  }
}

export function serializeHttpRequest(req: IncomingMessage & { id?: unknown }) {
  return {
    id: req.id,
    method: req.method,
    url: safeRequestUrl(req.url),
    remoteAddress: req.socket?.remoteAddress,
    remotePort: req.socket?.remotePort
  };
}

export function serializeHttpResponse(res: ServerResponse) {
  return {
    statusCode: res.statusCode
  };
}
