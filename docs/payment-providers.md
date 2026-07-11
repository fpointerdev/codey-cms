# Payment Provider Operations

Stripe, PayPal, and manual payments are configured per site under **Shop > Shop Configuration**. Provider credentials belong to the site owner and are stored in `PaymentProviderConfig`, not in `.env`.

## Secret Boundary

- `CMS_CREDENTIAL_ENCRYPTION_KEY` is the only deployment-level payment-related secret. It encrypts dashboard-supplied credentials with AES-256-GCM.
- Stripe secret keys, Stripe webhook signing secrets, and PayPal client secrets are write-only. Admin reads return only `*Configured` booleans.
- Stripe publishable keys, PayPal client IDs, provider mode, and manual instructions are non-secret configuration.
- Audit records contain provider, mode, enabled state, and configured-field booleans. They never contain credentials or ciphertext.

Losing or changing `CMS_CREDENTIAL_ENCRYPTION_KEY` makes existing encrypted credentials unreadable. Restore the original key or re-enter every provider secret.

## Admin Setup

### Stripe

1. Select Sandbox and save a matching `pk_test_...` plus `sk_test_...` or restricted `rk_test_...` key.
2. Create a Stripe webhook using the endpoint shown in the dashboard.
3. Subscribe to `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, and `charge.refunded`.
4. Save the endpoint signing secret (`whsec_...`).
5. Run **Test connection**, then enable Stripe.
6. Repeat with matching live keys when moving to Live mode.

### PayPal

1. Select Sandbox and save the PayPal REST app client ID and client secret.
2. Create a PayPal webhook using the endpoint shown in the dashboard.
3. Subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `CHECKOUT.ORDER.VOIDED`, and `PAYMENT.CAPTURE.REFUNDED`.
4. Save the PayPal webhook ID.
5. Run **Test connection**, then enable PayPal.
6. Use a live PayPal app and live webhook ID when moving to Live mode.

The Stripe test validates account access. The PayPal test validates OAuth access and confirms that the webhook ID exists in that account and environment. Actual webhook delivery is shown separately as **Last verified webhook**.

### Manual

Save customer-facing instructions and enable the method. A manual payment stays pending until a user with `update:payments` marks it paid or failed from the Orders screen. A successful manual payment can later be marked refunded.

## API Flow

- `GET /api/v1/payments/providers/public`: enabled methods and public checkout identifiers.
- `POST /api/v1/payments/intent`: creates or resumes a provider payment for a payable order.
- Stripe response: `clientSecret`, `publishableKey`, provider reference, and provider status.
- PayPal response: approval URL, client ID, provider reference, and provider status.
- `POST /api/v1/payments/paypal/capture`: captures an approved PayPal order. It first retrieves provider state, so a retry after a lost capture response remains safe.
- `POST /api/v1/payments/webhooks/stripe`: verifies the raw body against `Stripe-Signature` with a five-minute tolerance.
- `POST /api/v1/payments/webhooks/paypal`: verifies transmission headers through PayPal's verification API and the saved webhook ID.

PayPal intent requests require `returnUrl` and `cancelUrl`. Their origins must match `APP_PUBLIC_URL`, the request origin, or a configured `CORS_ORIGINS` entry; production URLs must use HTTPS.

Shop runtimes include Stripe.js, Stripe frame, and Stripe API origins in the Content Security Policy. The PayPal flow uses the returned approval URL and does not require loading the PayPal JavaScript SDK.

## State And Retry Cases

- Duplicate intent: reuse the same `idempotencyKey`; a key cannot be reused for another order or provider.
- Active provider: one order can have only one active provider payment. Select the method before creating the intent; a second provider is blocked to prevent double payment.
- Lost provider-create response: the pending local payment is retried with the same provider idempotency key.
- Lost PayPal capture response: capture first retrieves the PayPal order and applies an existing completed capture.
- Duplicate webhook: `providerEventId` returns the prior result without applying order state twice.
- Provider disabled: no new intents are created, but retained credentials continue to verify webhooks for payments already in flight.
- Credential or mode change: the dashboard disables that provider and clears its connection-test status until it passes again.
- Failed connection retest: an enabled provider is disabled automatically.
- Failed Stripe attempt: `payment_intent.payment_failed` keeps the reusable PaymentIntent and inventory reservation active so the buyer can try another payment method; cancellation or reservation expiry is terminal.
- Failed or cancelled payment: inventory and coupon reservations are released atomically.
- Late success after reservation expiry: the event is rejected instead of overselling released inventory and requires operator reconciliation.
- Amount or currency mismatch: the event is rejected and the order remains unpaid.
- Partial PayPal refund: cumulative refunded cents are recorded in payment metadata; the payment and order become `REFUNDED` only when the full amount has been refunded.
- Full Stripe refund: `charge.refunded` marks the payment and order refunded.

## Release Checklist

1. Apply migrations and back up the database plus `CMS_CREDENTIAL_ENCRYPTION_KEY`.
2. Test Stripe and PayPal in sandbox with real provider accounts.
3. Complete success, cancellation, failed-payment, duplicate-request, and refund checks.
4. Confirm the dashboard shows a recent verified webhook for each online provider.
5. Switch to Live, enter matching live credentials, recreate live webhooks, retest, and then enable.
6. Keep manual payment available only when staff have an operational settlement process.
