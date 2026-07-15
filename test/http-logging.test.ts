import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  safeRequestUrl,
  serializeHttpRequest,
  serializeHttpResponse
} from "../src/infrastructure/logging/http-logging.js";

test("HTTP logs omit headers and redact sensitive query values", () => {
  const request = {
    id: "request-1",
    method: "GET",
    url: "/auth/callback?page=2&access_token=secret-value&code=private-code",
    headers: {
      authorization: "Bearer admin-token",
      cookie: "session=private"
    },
    socket: {
      remoteAddress: "127.0.0.1",
      remotePort: 4100
    }
  } as unknown as IncomingMessage & { id: unknown };

  assert.deepEqual(serializeHttpRequest(request), {
    id: "request-1",
    method: "GET",
    url: "/auth/callback?page=2&access_token=%5BRedacted%5D&code=%5BRedacted%5D",
    remoteAddress: "127.0.0.1",
    remotePort: 4100
  });
  assert.equal("headers" in serializeHttpRequest(request), false);
  assert.equal(safeRequestUrl("not a valid URL?token=secret"), "/not%20a%20valid%20URL?token=%5BRedacted%5D");
});

test("HTTP response logs contain only the status code", () => {
  const response = {
    statusCode: 204,
    getHeaders: () => ({ "set-cookie": "session=private" })
  } as unknown as ServerResponse;

  assert.deepEqual(serializeHttpResponse(response), { statusCode: 204 });
});
