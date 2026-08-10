import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { AppConfig } from "../../config/index.js";
import { AppError } from "../../core/errors/app-error.js";
import type {
  EmailClient,
  EmailDeliveryConfig,
  EmailDeliveryResult,
  EmailMessage,
  EmailProvider
} from "./email.types.js";

const providerEndpoints: Record<Exclude<EmailProvider, "generic">, string> = {
  resend: "https://api.resend.com/emails",
  postmark: "https://api.postmarkapp.com/email"
};

type AddressRecord = { address: string; family: number };
type AddressLookup = (hostname: string) => Promise<AddressRecord[]>;

const maximumProviderResponseBytes = 64 * 1024;

function endpointHostname(endpoint: URL) {
  return endpoint.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

export function parseEmailEndpoint(value: string, options: { requireHttps?: boolean } = {}) {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new AppError(422, "email_endpoint_invalid", "Email endpoint must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) {
    throw new AppError(422, "email_endpoint_invalid", "Email endpoint must be a valid HTTP or HTTPS URL.");
  }
  if (options.requireHttps && endpoint.protocol !== "https:") {
    throw new AppError(422, "email_endpoint_insecure", "Email endpoint must use HTTPS in production.");
  }
  if (endpoint.username || endpoint.password) {
    throw new AppError(422, "email_endpoint_credentials_forbidden", "Email endpoint cannot contain URL credentials.");
  }
  if (endpoint.hash) {
    throw new AppError(422, "email_endpoint_fragment_forbidden", "Email endpoint cannot contain a URL fragment.");
  }
  return endpoint;
}

function ipv4Bytes(address: string) {
  const bytes = address.split(".").map(Number);
  return bytes.length === 4 && bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    ? bytes
    : null;
}

function isPublicIpv4(address: string) {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const [first, second, third] = bytes;
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false;
  if (first === 100 && second >= 64 && second <= 127) return false;
  if (first === 169 && second === 254) return false;
  if (first === 172 && second >= 16 && second <= 31) return false;
  if (first === 192 && second === 168) return false;
  if (first === 192 && second === 0 && third === 0) return false;
  if (first === 192 && second === 0 && third === 2) return false;
  if (first === 192 && second === 31 && third === 196) return false;
  if (first === 192 && second === 52 && third === 193) return false;
  if (first === 192 && second === 88 && third === 99) return false;
  if (first === 192 && second === 175 && third === 48) return false;
  if (first === 198 && (second === 18 || second === 19)) return false;
  if (first === 198 && second === 51 && third === 100) return false;
  if (first === 203 && second === 0 && third === 113) return false;
  return true;
}

function ipv6Bytes(address: string) {
  let normalized = address.toLowerCase().split("%", 1)[0];
  const ipv4Tail = normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const bytes = ipv4Bytes(ipv4Tail);
    if (!bytes) return null;
    const first = (bytes[0] << 8 | bytes[1]).toString(16);
    const second = (bytes[2] << 8 | bytes[3]).toString(16);
    normalized = normalized.slice(0, -ipv4Tail.length) + `${first}:${second}`;
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || halves.length === 1 && missing !== 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function isPublicIpv6(address: string) {
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const isIpv4Mapped = bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff && bytes[11] === 0xff;
  if (isIpv4Mapped) return isPublicIpv4(bytes.slice(12).join("."));
  const globalUnicast = bytes[0] >= 0x20 && bytes[0] <= 0x3f;
  if (!globalUnicast) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return false;
    if (bytes[2] === 0x00 && bytes[3] === 0x02) return false;
    if (bytes[2] === 0x00 && (bytes[3] & 0xf0) === 0x10) return false;
    if (bytes[2] === 0x00 && (bytes[3] & 0xf0) === 0x20) return false;
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return false;
  return true;
}

export function isPublicEmailAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

async function defaultAddressLookup(hostname: string) {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

export function createPinnedEmailLookup(addresses: AddressRecord[]): LookupFunction {
  const approved = [...new Map(addresses.map(({ address }) => {
    const family = isIP(address);
    return [address, { address, family }];
  })).values()].filter((record) => record.family === 4 || record.family === 6);

  return (_hostname, options, callback) => {
    const family = options.family;
    const candidates = family === 4 || family === 6
      ? approved.filter((record) => record.family === family)
      : approved;
    if (candidates.length === 0) {
      const error = new Error("No approved address is available for the requested family.") as NodeJS.ErrnoException;
      error.code = "ENOTFOUND";
      callback(error, "", 0);
      return;
    }

    if (options.all) {
      callback(null, candidates);
      return;
    }

    callback(null, candidates[0].address, candidates[0].family);
  };
}

export async function resolveSafeEmailEndpoint(
  value: string,
  options: { requireHttps?: boolean; lookup?: AddressLookup } = {}
) {
  const endpoint = parseEmailEndpoint(value, { requireHttps: options.requireHttps });
  const hostname = endpointHostname(endpoint);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new AppError(422, "email_endpoint_private", "Email endpoint must resolve to a public address.");
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await (options.lookup ?? defaultAddressLookup)(hostname).catch(() => {
        throw new AppError(422, "email_endpoint_unreachable", "Email endpoint hostname could not be resolved.");
      });
  const normalizedAddresses = addresses.map(({ address }) => ({ address, family: isIP(address) }));
  if (
    !normalizedAddresses.length ||
    normalizedAddresses.some(({ address, family }) => !family || !isPublicEmailAddress(address))
  ) {
    throw new AppError(422, "email_endpoint_private", "Email endpoint must resolve only to public addresses.");
  }

  return { endpoint, addresses: normalizedAddresses };
}

export async function assertSafeEmailEndpoint(
  value: string,
  options: { requireHttps?: boolean; lookup?: AddressLookup } = {}
) {
  return (await resolveSafeEmailEndpoint(value, options)).endpoint;
}

function provider(config: EmailDeliveryConfig) {
  return config.provider || "generic";
}

export function emailProviderEndpoint(config: EmailDeliveryConfig) {
  const selectedProvider = provider(config);
  return selectedProvider === "generic" ? config.httpEndpoint : providerEndpoints[selectedProvider];
}

function deliveryConfig(config: AppConfig | EmailDeliveryConfig): EmailDeliveryConfig {
  return "email" in config
    ? { ...config.email, protectInternalEndpoints: config.isProduction }
    : config;
}

export function isEmailDeliveryConfigured(config: AppConfig | EmailDeliveryConfig) {
  const email = deliveryConfig(config);
  const selectedProvider = provider(email);

  return email.driver === "http" && Boolean(
    email.from &&
    emailProviderEndpoint(email) &&
    email.credentialsRequired !== true &&
    (selectedProvider === "generic" || email.httpBearerToken)
  );
}

export function createEmailClient(config: AppConfig | EmailDeliveryConfig): EmailClient {
  if (!isEmailDeliveryConfigured(config)) {
    throw new AppError(503, "email_not_configured", "Transactional email is not configured.");
  }

  const email = deliveryConfig(config);

  return {
    send: (message) => sendHttpEmail(email, message)
  };
}

async function sendHttpEmail(
  config: EmailDeliveryConfig,
  message: EmailMessage
): Promise<EmailDeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const selectedProvider = provider(config);
    const endpoint = emailProviderEndpoint(config)!;
    if (config.protectInternalEndpoints) {
      const safeEndpoint = await resolveSafeEmailEndpoint(endpoint, { requireHttps: true });
      return sendPinnedHttpEmail(
        safeEndpoint.endpoint,
        safeEndpoint.addresses,
        selectedProvider,
        config.httpBearerToken,
        message,
        controller.signal
      );
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders(selectedProvider, config.httpBearerToken),
      body: JSON.stringify(requestBody(selectedProvider, message)),
      redirect: "manual",
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Email provider returned ${response.status}.`);
    }

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      messageId?: string;
      providerMessageId?: string;
      MessageID?: string;
    };

    return {
      providerMessageId: data.providerMessageId ?? data.messageId ?? data.id ?? data.MessageID
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function sendPinnedHttpEmail(
  endpoint: URL,
  addresses: AddressRecord[],
  selectedProvider: EmailProvider,
  credential: string | undefined,
  message: EmailMessage,
  signal: AbortSignal
): Promise<EmailDeliveryResult> {
  const body = JSON.stringify(requestBody(selectedProvider, message));
  const response = await requestPinnedEndpoint(endpoint, addresses, {
    body,
    headers: requestHeaders(selectedProvider, credential),
    signal
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Email provider returned ${response.statusCode}.`);
  }

  const data = parseProviderResponse(response.body);
  return {
    providerMessageId: data.providerMessageId ?? data.messageId ?? data.id ?? data.MessageID
  };
}

function requestPinnedEndpoint(
  endpoint: URL,
  addresses: AddressRecord[],
  input: { body: string; headers: Record<string, string>; signal: AbortSignal }
) {
  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const request = (endpoint.protocol === "https:" ? httpsRequest : httpRequest)(endpoint, {
      method: "POST",
      headers: {
        ...input.headers,
        "content-length": Buffer.byteLength(input.body).toString()
      },
      lookup: createPinnedEmailLookup(addresses),
      signal: input.signal
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;

      response.on("data", (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maximumProviderResponseBytes) {
          response.destroy(new Error("Email provider response exceeded the configured limit."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("error", reject);
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 502,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });

    request.on("error", reject);
    request.end(input.body);
  });
}

function parseProviderResponse(body: string) {
  try {
    return JSON.parse(body || "{}") as {
      id?: string;
      messageId?: string;
      providerMessageId?: string;
      MessageID?: string;
    };
  } catch {
    return {};
  }
}

function requestHeaders(provider: EmailProvider, credential?: string): Record<string, string> {
  if (provider === "postmark") {
    return {
      "content-type": "application/json",
      "x-postmark-server-token": credential!
    };
  }

  const headers: Record<string, string> = { "content-type": "application/json" };
  if (credential) headers.authorization = `Bearer ${credential}`;
  return headers;
}

function requestBody(provider: EmailProvider, message: EmailMessage) {
  if (provider === "resend") {
    return {
      from: message.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html
    };
  }

  if (provider === "postmark") {
    return {
      From: message.from,
      To: message.to,
      Subject: message.subject,
      TextBody: message.text,
      HtmlBody: message.html,
      MessageStream: "outbound",
      Metadata: message.metadata
    };
  }

  return message;
}
