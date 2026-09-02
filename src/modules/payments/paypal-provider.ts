import type { PaymentStatus, PaymentProviderMode } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import { providerJsonRequest, type ProviderFetch } from "./payment-provider-http.js";

type PayPalLink = {
  href: string;
  rel: string;
  method?: string;
};

export type PayPalOrder = {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    custom_id?: string;
    invoice_id?: string;
    amount?: { currency_code?: string; value?: string };
    payments?: {
      captures?: Array<{
        id: string;
        status: string;
        amount?: { currency_code?: string; value?: string };
      }>;
    };
  }>;
};

export type PayPalRefund = {
  id: string;
  status: string;
  amount?: { currency_code?: string; value?: string };
};

export type PayPalCapture = {
  id: string;
  status: string;
  amount?: { currency_code?: string; value?: string };
  supplementary_data?: {
    related_ids?: { order_id?: string };
  };
};

type PayPalToken = {
  access_token: string;
};

export type PayPalWebhookEvent = {
  id: string;
  event_type: string;
  summary?: string;
  resource?: Record<string, unknown>;
};

function paypalApiBase(mode: PaymentProviderMode) {
  return mode === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function paypalAccessToken(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  fetchImpl?: ProviderFetch;
}) {
  const credentials = Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64");
  const token = await providerJsonRequest<PayPalToken>(
    "paypal",
    `${paypalApiBase(input.mode)}/v1/oauth2/token`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${credentials}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({ grant_type: "client_credentials" })
    },
    input.fetchImpl
  );

  if (!token.access_token) {
    throw new AppError(502, "paypal_token_missing", "PayPal did not return an access token.");
  }

  return token.access_token;
}

function paypalAmount(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

export function paymentStatusFromPayPal(status: string): PaymentStatus {
  if (status === "COMPLETED") return "SUCCEEDED";
  if (["VOIDED", "DECLINED", "DENIED", "FAILED"].includes(status)) return "FAILED";
  if (["CREATED", "SAVED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(status)) {
    return "REQUIRES_ACTION";
  }
  return "PENDING";
}

export async function createPayPalOrder(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  paymentId: string;
  orderId: string;
  orderNumber?: string | null;
  amountCents: number;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
  fetchImpl?: ProviderFetch;
}) {
  const accessToken = await paypalAccessToken(input);
  const order = await providerJsonRequest<PayPalOrder>(
    "paypal",
    `${paypalApiBase(input.mode)}/v2/checkout/orders`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "paypal-request-id": input.paymentId
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: input.paymentId,
          custom_id: input.paymentId,
          ...(input.orderNumber ? { invoice_id: input.orderNumber } : {}),
          amount: {
            currency_code: input.currency.toUpperCase(),
            value: paypalAmount(input.amountCents)
          }
        }],
        payment_source: {
          paypal: {
            experience_context: {
              user_action: "PAY_NOW",
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl
            }
          }
        }
      })
    },
    input.fetchImpl
  );

  const approveUrl = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;
  if (!order.id || !approveUrl) {
    throw new AppError(502, "paypal_approval_url_missing", "PayPal did not return an approval URL.");
  }

  return { ...order, approveUrl };
}

export async function retrievePayPalOrder(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  providerReference: string;
  fetchImpl?: ProviderFetch;
}) {
  const accessToken = await paypalAccessToken(input);
  const order = await providerJsonRequest<PayPalOrder>(
    "paypal",
    `${paypalApiBase(input.mode)}/v2/checkout/orders/${encodeURIComponent(input.providerReference)}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` }
    },
    input.fetchImpl
  );
  const approveUrl = order.links?.find((link) => link.rel === "payer-action" || link.rel === "approve")?.href;

  return { ...order, approveUrl };
}

export async function capturePayPalOrder(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  providerReference: string;
  paymentId: string;
  fetchImpl?: ProviderFetch;
}) {
  const accessToken = await paypalAccessToken(input);

  return providerJsonRequest<PayPalOrder>(
    "paypal",
    `${paypalApiBase(input.mode)}/v2/checkout/orders/${encodeURIComponent(input.providerReference)}/capture`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "paypal-request-id": `${input.paymentId}-capture`
      },
      body: "{}"
    },
    input.fetchImpl
  );
}

export function completedPayPalCapture(order: PayPalOrder) {
  return order.purchase_units
    ?.flatMap((unit) => unit.payments?.captures ?? [])
    .find((capture) => capture.status === "COMPLETED");
}

export async function retrievePayPalCapture(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  captureId: string;
  fetchImpl?: ProviderFetch;
}) {
  const accessToken = await paypalAccessToken(input);
  return providerJsonRequest<PayPalCapture>(
    "paypal",
    `${paypalApiBase(input.mode)}/v2/payments/captures/${encodeURIComponent(input.captureId)}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` }
    },
    input.fetchImpl
  );
}

export function payPalOrderReferenceForCapture(capture: PayPalCapture) {
  return capture.supplementary_data?.related_ids?.order_id;
}

export async function createPayPalRefund(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  captureId: string;
  refundId: string;
  amountCents: number;
  currency: string;
  fetchImpl?: ProviderFetch;
}) {
  const accessToken = await paypalAccessToken(input);

  return providerJsonRequest<PayPalRefund>(
    "paypal",
    `${paypalApiBase(input.mode)}/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "paypal-request-id": input.refundId,
        prefer: "return=representation"
      },
      body: JSON.stringify({
        amount: {
          currency_code: input.currency.toUpperCase(),
          value: paypalAmount(input.amountCents)
        }
      })
    },
    input.fetchImpl
  );
}

export async function testPayPalConnection(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  webhookId: string;
  fetchImpl?: ProviderFetch;
}) {
  const accessToken = await paypalAccessToken(input);
  const webhook = await providerJsonRequest<{ id?: string; url?: string }>(
    "paypal",
    `${paypalApiBase(input.mode)}/v1/notifications/webhooks/${encodeURIComponent(input.webhookId)}`,
    {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` }
    },
    input.fetchImpl
  );

  if (webhook.id !== input.webhookId) {
    throw new AppError(422, "paypal_webhook_not_found", "PayPal webhook ID was not found in this account.");
  }

  return `Connected to PayPal. Webhook ${input.webhookId} is available.`;
}

export async function verifyPayPalWebhook(input: {
  mode: PaymentProviderMode;
  clientId: string;
  clientSecret: string;
  webhookId: string;
  headers: {
    authAlgo?: string;
    certUrl?: string;
    transmissionId?: string;
    transmissionSignature?: string;
    transmissionTime?: string;
  };
  event: PayPalWebhookEvent;
  fetchImpl?: ProviderFetch;
}) {
  const missingHeader = Object.values(input.headers).some((value) => !value);
  if (missingHeader) {
    throw new AppError(401, "paypal_signature_missing", "PayPal webhook signature headers are incomplete.");
  }

  const accessToken = await paypalAccessToken(input);
  const verification = await providerJsonRequest<{ verification_status?: string }>(
    "paypal",
    `${paypalApiBase(input.mode)}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSignature,
        transmission_time: input.headers.transmissionTime,
        webhook_id: input.webhookId,
        webhook_event: input.event
      })
    },
    input.fetchImpl
  );

  if (verification.verification_status !== "SUCCESS") {
    throw new AppError(401, "paypal_signature_invalid", "PayPal webhook signature is invalid.");
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function linkedPayPalResourceId(resource: Record<string, unknown>, name: string) {
  const links = Array.isArray(resource.links) ? resource.links : [];
  const href = links
    .map(nestedRecord)
    .find((link) => link.rel === "up" && typeof link.href === "string")?.href;
  if (typeof href !== "string") return undefined;

  try {
    const parts = new URL(href).pathname.split("/").filter(Boolean);
    const index = parts.indexOf(name);
    return index >= 0 && parts[index + 1] ? decodeURIComponent(parts[index + 1]) : undefined;
  } catch {
    return undefined;
  }
}

export function centsFromPayPalAmount(value: unknown) {
  const amount = nestedRecord(value);
  const numericValue = typeof amount.value === "string" ? Number(amount.value) : NaN;
  return Number.isFinite(numericValue) ? Math.round(numericValue * 100) : undefined;
}

export function normalizePayPalWebhook(event: PayPalWebhookEvent) {
  const resource = event.resource ?? {};
  let eventType:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.refunded"
    | "payment.refund_pending"
    | "payment.refund_failed"
    | undefined;

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    eventType = "payment.succeeded";
  } else if ([
    "PAYMENT.CAPTURE.DENIED",
    "PAYMENT.CAPTURE.DECLINED",
    "CHECKOUT.ORDER.VOIDED"
  ].includes(event.event_type)) {
    eventType = "payment.failed";
  } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
    eventType = "payment.refunded";
  } else if (event.event_type === "PAYMENT.REFUND.PENDING") {
    eventType = "payment.refund_pending";
  } else if (event.event_type === "PAYMENT.REFUND.FAILED") {
    eventType = "payment.refund_failed";
  }

  if (!eventType || !event.id) return null;

  const supplementaryData = nestedRecord(resource.supplementary_data);
  const relatedIds = nestedRecord(supplementaryData.related_ids);
  const providerReference = stringValue(relatedIds.order_id) ||
    stringValue(resource.order_id) ||
    (event.event_type === "CHECKOUT.ORDER.VOIDED" ? stringValue(resource.id) : undefined);
  const refundEvent = eventType === "payment.refunded" ||
    eventType === "payment.refund_pending" ||
    eventType === "payment.refund_failed";
  const refundReference = refundEvent ? stringValue(resource.id) : undefined;
  const captureReference = refundEvent
    ? stringValue(relatedIds.capture_id) || linkedPayPalResourceId(resource, "captures")
    : stringValue(resource.id);
  if (!providerReference && !refundReference && !captureReference) return null;

  const amount = nestedRecord(resource.amount);
  const statusDetails = nestedRecord(resource.status_details);

  return {
    provider: "PAYPAL" as const,
    eventType,
    providerEventId: event.id,
    ...(providerReference ? { providerReference } : {}),
    paymentId: stringValue(resource.custom_id),
    ...(refundReference ? { refundReference } : {}),
    ...(captureReference ? { captureReference } : {}),
    amountCents: centsFromPayPalAmount(resource.amount),
    currency: stringValue(amount.currency_code)?.toUpperCase(),
    ...(eventType === "payment.refund_failed"
      ? {
          failureMessage: stringValue(statusDetails.reason) ||
            event.summary ||
            "PayPal reported that the refund failed."
        }
      : {}),
    payload: event as unknown as Record<string, unknown>
  };
}
