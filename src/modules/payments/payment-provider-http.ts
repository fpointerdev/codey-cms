import { AppError } from "../../core/errors/app-error.js";

export type ProviderFetch = typeof fetch;

function providerErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;

  const record = payload as Record<string, unknown>;
  const nestedError = record.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : null;
  const message = nestedError?.message ?? record.message ?? record.error_description;

  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 500)
    : fallback;
}

export async function providerJsonRequest<T>(
  provider: "stripe" | "paypal",
  url: string,
  init: RequestInit,
  fetchImpl: ProviderFetch = fetch
): Promise<T> {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(15_000)
    });
  } catch (error) {
    const timedOut = error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    throw new AppError(
      502,
      `${provider}_api_unavailable`,
      timedOut
        ? `${provider === "stripe" ? "Stripe" : "PayPal"} did not respond in time.`
        : `${provider === "stripe" ? "Stripe" : "PayPal"} could not be reached.`
    );
  }

  const responseText = await response.text();
  let payload: unknown = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      payload = { message: responseText.slice(0, 500) };
    }
  }

  if (!response.ok) {
    const providerName = provider === "stripe" ? "Stripe" : "PayPal";
    const message = providerErrorMessage(payload, `${providerName} rejected the request.`);
    const invalidCredentials = response.status === 401 || response.status === 403;
    const rateLimited = response.status === 429;

    throw new AppError(
      invalidCredentials ? 422 : rateLimited ? 503 : response.status >= 500 ? 502 : 422,
      invalidCredentials
        ? `${provider}_credentials_rejected`
        : rateLimited
          ? `${provider}_rate_limited`
          : `${provider}_request_rejected`,
      message
    );
  }

  return payload as T;
}
