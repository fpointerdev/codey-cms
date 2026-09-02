const cartStorageKey = "codey_shop_cart";
const orderStorageKey = "codey_shop_pending_order";

let cart = null;
let providers = [];
let shippingZones = [];
let dialog = null;
let stripe = null;
let stripeElements = null;

const worldwideCountryCodes = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET",
  "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT",
  "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ",
  "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY",
  "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW"
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(cents = 0, currency = "EUR") {
  try {
    return new Intl.NumberFormat(document.documentElement.lang || "en", {
      style: "currency",
      currency: String(currency || "EUR").toUpperCase()
    }).format(Number(cents || 0) / 100);
  } catch {
    return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
  }
}

function localizedCommercePath(path) {
  const normalizedPath = `/${String(path || "").replace(/^\/+/, "")}`;
  const [pathLocale] = window.location.pathname.split("/").filter(Boolean);
  const documentLocale = String(document.documentElement.lang || "").toLowerCase();
  const activeLocale = String(pathLocale || "").toLowerCase();

  return documentLocale && activeLocale === documentLocale
    ? `/${encodeURIComponent(pathLocale)}${normalizedPath}`
    : normalizedPath;
}

async function request(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.error?.message || "The shop could not complete this request.");
  }

  return payload.data;
}

function cartToken() {
  return localStorage.getItem(cartStorageKey) || "";
}

function setCart(nextCart) {
  cart = nextCart;
  if (cart?.sessionToken) localStorage.setItem(cartStorageKey, cart.sessionToken);
  updateCartCounts();
}

function clearCart() {
  cart = null;
  localStorage.removeItem(cartStorageKey);
  updateCartCounts();
}

function pendingOrder() {
  try {
    return JSON.parse(sessionStorage.getItem(orderStorageKey) || "null");
  } catch {
    sessionStorage.removeItem(orderStorageKey);
    return null;
  }
}

function itemCount() {
  return cart?.items?.reduce((total, item) => total + Number(item.quantity || 0), 0) || 0;
}

function updateCartCounts() {
  const count = itemCount();
  document.querySelectorAll("[data-commerce-cart-count]").forEach((element) => {
    element.textContent = String(count);
  });
}

async function ensureCart() {
  if (cart?.sessionToken) return cart;
  const token = cartToken();
  if (token) {
    try {
      const result = await request(`/orders/carts/${encodeURIComponent(token)}`);
      setCart(result.cart);
      return cart;
    } catch {
      localStorage.removeItem(cartStorageKey);
    }
  }

  const result = await request("/orders/carts", {
    method: "POST",
    body: JSON.stringify({})
  });
  setCart(result.cart);
  return cart;
}

function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.className = "commerce-dialog";
  dialog.dataset.commerceDialog = "";
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function openDialog() {
  const element = ensureDialog();
  if (!element.open) element.showModal();
}

function closeButton() {
  return '<button type="button" class="commerce-dialog-close" data-commerce-close aria-label="Close">&times;</button>';
}

function dateLabel(value) {
  if (!value) return "";

  try {
    return new Intl.DateTimeFormat(document.documentElement.lang || "en", {
      dateStyle: "medium"
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function statusLabel(value = "") {
  return String(value).toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function buyerOrderProgress(order) {
  const steps = ["Placed", "Confirmed", "On the way", "Delivered"];
  const trackingStatus = order.tracking?.status || "";
  let activeIndex = 0;
  if (["CONFIRMED", "PAID", "FULFILLED", "REFUNDED"].includes(order.status)) activeIndex = 1;
  if (["SHIPPED", "IN_TRANSIT", "OUT_FOR_DELIVERY", "DELAYED"].includes(trackingStatus)) activeIndex = 2;
  if (trackingStatus === "DELIVERED" || order.status === "FULFILLED") activeIndex = 3;

  return `
    <ol class="buyer-order-progress" aria-label="Order progress">
      ${steps.map((step, index) => `
        <li class="${index < activeIndex ? "complete" : index === activeIndex ? "active" : ""}">
          <span aria-hidden="true">${index < activeIndex ? "&#10003;" : index + 1}</span>
          <strong>${escapeHtml(step)}</strong>
        </li>
      `).join("")}
    </ol>
  `;
}

function buyerTrackingMarkup(tracking) {
  if (!tracking) {
    return '<p class="buyer-order-note">Tracking will appear here when the order is prepared for delivery.</p>';
  }

  const details = [tracking.carrier, tracking.trackingNumber].filter(Boolean).join(" · ");
  return `
    <div class="buyer-order-tracking">
      <div>
        <span>Delivery</span>
        <strong>${escapeHtml(statusLabel(tracking.status))}</strong>
        ${details ? `<small>${escapeHtml(details)}</small>` : ""}
      </div>
      ${tracking.estimatedDeliveryAt ? `<div><span>Estimated</span><strong>${escapeHtml(dateLabel(tracking.estimatedDeliveryAt))}</strong></div>` : ""}
      ${tracking.trackingUrl ? `<a class="secondary-button" href="${escapeHtml(tracking.trackingUrl)}" target="_blank" rel="noopener noreferrer">Track parcel</a>` : ""}
      ${tracking.note ? `<p>${escapeHtml(tracking.note)}</p>` : ""}
    </div>
  `;
}

function buyerCasesMarkup(cases = [], currency = "EUR") {
  if (!cases.length) return "";

  return `
    <div class="buyer-order-cases">
      <h3>Requests</h3>
      ${cases.map((supportCase) => `
        <article>
          <div><strong>${escapeHtml(supportCase.subject)}</strong><span class="status-pill">${escapeHtml(statusLabel(supportCase.status))}</span></div>
          <p>${escapeHtml(supportCase.message)}</p>
          ${supportCase.type === "REFUND" && supportCase.requestedRefundCents
            ? `<p><strong>Requested refund:</strong> ${escapeHtml(money(supportCase.requestedRefundCents, currency))}</p>`
            : ""}
          ${supportCase.merchantResponse ? `<blockquote><strong>Shop response</strong><p>${escapeHtml(supportCase.merchantResponse)}</p></blockquote>` : ""}
          <small>${escapeHtml(statusLabel(supportCase.type))} · ${escapeHtml(dateLabel(supportCase.createdAt))}</small>
        </article>
      `).join("")}
    </div>
  `;
}

function buyerOrderMarkup(order) {
  const inactive = ["CANCELLED", "REFUNDED"].includes(order.status);
  const openCancellation = order.supportCases?.some((supportCase) => (
    supportCase.type === "CANCELLATION" && ["OPEN", "IN_REVIEW"].includes(supportCase.status)
  ));
  const activeRefundRequest = order.supportCases?.find((supportCase) => (
    supportCase.type === "REFUND" && ["OPEN", "IN_REVIEW", "APPROVED"].includes(supportCase.status)
  ));
  const remainingRefundCents = Math.max(0, order.totalCents - (order.refundedCents || 0));
  const canRequestRefund = ["PAID", "FULFILLED"].includes(order.status) && remainingRefundCents > 0;
  const visibleStatus = order.tracking?.status || order.status;
  return `
    <article class="buyer-order-card" data-buyer-order="${escapeHtml(order.orderNumber)}">
      <header>
        <div><p>Order ${escapeHtml(order.orderNumber)}</p><h3>${escapeHtml(dateLabel(order.createdAt))}</h3></div>
        <span class="status-pill${inactive ? " error" : ""}">${escapeHtml(statusLabel(visibleStatus))}</span>
      </header>
      ${inactive ? `<p class="buyer-order-state-message">This order is ${escapeHtml(statusLabel(order.status).toLowerCase())}.</p>` : buyerOrderProgress(order)}
      <div class="buyer-order-items">
        ${(order.items || []).map((item) => `
          <div>
            <span><strong>${escapeHtml(item.productName)}</strong>${item.variantName ? `<small>${escapeHtml(item.variantName)}</small>` : ""}</span>
            <span>${escapeHtml(item.quantity)} &times; ${escapeHtml(money(item.unitPriceCents, order.currency))}</span>
          </div>
        `).join("")}
      </div>
      ${buyerTrackingMarkup(order.tracking)}
      <div class="buyer-order-total"><span>Total</span><strong>${escapeHtml(money(order.totalCents, order.currency))}</strong></div>
      ${order.refundedCents > 0
        ? `<div class="buyer-order-total buyer-order-refund"><span>Refunded</span><strong>${escapeHtml(money(order.refundedCents, order.currency))}</strong></div>`
        : ""}
      ${buyerCasesMarkup(order.supportCases, order.currency)}
      <footer>
        ${canRequestRefund
          ? activeRefundRequest
            ? `<span class="buyer-refund-pending">Refund request ${escapeHtml(statusLabel(activeRefundRequest.status).toLowerCase())}</span>`
            : `<button type="button" class="secondary-button" data-buyer-refund="${escapeHtml(order.orderNumber)}" data-refund-max-cents="${escapeHtml(remainingRefundCents)}" data-refund-currency="${escapeHtml(order.currency)}">Request refund</button>`
          : ""}
        ${inactive
          ? ""
          : openCancellation
            ? '<span class="buyer-cancellation-pending">Cancellation pending</span>'
            : `<button type="button" class="secondary-button danger" data-buyer-cancel="${escapeHtml(order.orderNumber)}">Cancel order</button>`}
        <button type="button" class="secondary-button" data-buyer-support="${escapeHtml(order.orderNumber)}">Get help</button>
      </footer>
    </article>
  `;
}

function renderBuyerOrders(orders = [], message = "") {
  const root = document.querySelector("[data-buyer-orders]");
  if (!root) return;

  root.innerHTML = `
    ${message ? `<p class="commerce-message">${escapeHtml(message)}</p>` : ""}
    ${orders.length
      ? orders.map(buyerOrderMarkup).join("")
      : '<div class="buyer-order-empty"><h3>No orders on this device</h3><p>Complete checkout here or add an order using the private token from its receipt.</p></div>'}
  `;
}

async function loadBuyerOrders(message = "") {
  const result = await request("/orders/buyer/orders");
  renderBuyerOrders(result.orders || [], message);
  return result.orders || [];
}

function cancellationMarkup(orderNumber) {
  return `
    <form class="commerce-dialog-shell" data-buyer-cancel-form data-order-number="${escapeHtml(orderNumber)}">
      <header class="commerce-dialog-header"><div><p>Order ${escapeHtml(orderNumber)}</p><h2>Cancel order</h2></div>${closeButton()}</header>
      <p>Unpaid orders are cancelled immediately when it is safe. Paid, authorized, or dispatched orders are sent to the shop for review.</p>
      <label><span>Reason</span><textarea name="reason" rows="5" minlength="3" maxlength="1000" required></textarea></label>
      <p class="commerce-message" data-commerce-message aria-live="polite"></p>
      <button type="submit" class="danger">Continue</button>
    </form>
  `;
}

function supportCaseMarkup(orderNumber) {
  return `
    <form class="commerce-dialog-shell" data-buyer-support-form data-order-number="${escapeHtml(orderNumber)}">
      <header class="commerce-dialog-header"><div><p>Order ${escapeHtml(orderNumber)}</p><h2>Contact the shop</h2></div>${closeButton()}</header>
      <label><span>Request type</span><select name="type"><option value="COMPLAINT">Problem or complaint</option><option value="RETURN">Return request</option><option value="OTHER">Other question</option></select></label>
      <label><span>Subject</span><input name="subject" minlength="3" maxlength="160" required /></label>
      <label><span>What happened?</span><textarea name="message" rows="7" minlength="10" maxlength="4000" required></textarea></label>
      <p class="commerce-message" data-commerce-message aria-live="polite"></p>
      <button type="submit">Send request</button>
    </form>
  `;
}

function refundRequestMarkup(orderNumber, maxCents, currency) {
  return `
    <form class="commerce-dialog-shell" data-buyer-refund-form data-order-number="${escapeHtml(orderNumber)}" data-refund-max-cents="${escapeHtml(maxCents)}">
      <header class="commerce-dialog-header"><div><p>Order ${escapeHtml(orderNumber)}</p><h2>Request a refund</h2></div>${closeButton()}</header>
      <p>Tell the shop why you are requesting a refund. The shop will review this request before any money is returned.</p>
      <label><span>Amount (${escapeHtml(currency)})</span><input name="amount" type="number" value="${escapeHtml((maxCents / 100).toFixed(2))}" min="0.01" max="${escapeHtml((maxCents / 100).toFixed(2))}" step="0.01" required /></label>
      <label><span>Reason</span><select name="reason"><option value="Changed my mind">Changed my mind</option><option value="Item not received">Item not received</option><option value="Item arrived damaged">Item arrived damaged</option><option value="Wrong item received">Wrong item received</option><option value="Other refund reason">Other</option></select></label>
      <label><span>Details</span><textarea name="message" rows="6" minlength="10" maxlength="4000" required></textarea></label>
      <p class="commerce-message" data-commerce-message aria-live="polite"></p>
      <button type="submit">Send refund request</button>
    </form>
  `;
}

function forgetBuyerSessionMarkup() {
  return `
    <form class="commerce-dialog-shell" data-buyer-forget-form>
      <header class="commerce-dialog-header"><div><p>Privacy</p><h2>Forget orders on this device?</h2></div>${closeButton()}</header>
      <p>This removes this browser's access to its saved order history. You can add an order again later with the private lookup token from its receipt.</p>
      <p class="commerce-message" data-commerce-message aria-live="polite"></p>
      <div class="commerce-dialog-actions">
        <button type="button" class="secondary-button" data-commerce-close>Keep orders</button>
        <button type="submit" class="danger">Forget this device</button>
      </div>
    </form>
  `;
}

function cartItemMarkup(item) {
  const product = item.product;
  const image = product?.image;
  const unavailable = !item.available;
  return `
    <article class="commerce-cart-item" data-commerce-cart-item="${escapeHtml(item.id)}">
      ${image?.url
        ? `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || product?.name || "Product")}" />`
        : '<div class="commerce-cart-image-placeholder" aria-hidden="true"></div>'}
      <div>
        <strong>${escapeHtml(product?.name || "Unavailable product")}</strong>
        ${item.variant?.name ? `<span>${escapeHtml(item.variant.name)}</span>` : ""}
        <small>${escapeHtml(unavailable ? "Unavailable" : money(item.lineTotalCents, product?.currency || cart?.currency))}</small>
      </div>
      <div class="commerce-cart-item-controls">
        <label>
          <span class="sr-only">Quantity for ${escapeHtml(product?.name || "product")}</span>
          <input type="number" min="1" max="${escapeHtml(Math.max(1, item.availableStock || 1))}" value="${escapeHtml(item.quantity)}" data-commerce-item-quantity="${escapeHtml(item.id)}" ${unavailable ? "disabled" : ""} />
        </label>
        <button type="button" class="commerce-remove-button" data-commerce-remove-item="${escapeHtml(item.id)}">Remove</button>
      </div>
    </article>
  `;
}

function cartMarkup(message = "") {
  const items = cart?.items || [];
  const hasUnavailable = items.some((item) => !item.available);
  return `
    <div class="commerce-dialog-shell">
      <header class="commerce-dialog-header">
        <div><p>Shopping cart</p><h2>${items.length ? `${itemCount()} item${itemCount() === 1 ? "" : "s"}` : "Your cart is empty"}</h2></div>
        ${closeButton()}
      </header>
      ${message ? `<p class="commerce-message">${escapeHtml(message)}</p>` : ""}
      <div class="commerce-cart-items">
        ${items.length ? items.map(cartItemMarkup).join("") : '<p class="commerce-empty">Products you add will stay here while you continue browsing.</p>'}
      </div>
      ${items.length ? `
        <footer class="commerce-cart-summary">
          <div><span>Subtotal</span><strong>${escapeHtml(money(cart.subtotalCents, cart.currency || items[0]?.product?.currency))}</strong></div>
          <small>Shipping, discounts, and tax are confirmed before payment.</small>
          ${hasUnavailable ? '<p class="commerce-message error">Remove unavailable items before checkout.</p>' : ""}
          <button type="button" data-commerce-start-checkout ${hasUnavailable ? "disabled" : ""}>Checkout</button>
        </footer>
      ` : ""}
    </div>
  `;
}

function countryOptions() {
  const countries = shippingZones.some((zone) => !zone.countries?.length)
    ? worldwideCountryCodes
    : [...new Set(shippingZones.flatMap((zone) => zone.countries || []))].sort();
  const names = typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames([document.documentElement.lang || "en"], { type: "region" })
    : null;
  return countries.map((country) => `<option value="${escapeHtml(country)}">${escapeHtml(names?.of(country) || country)}</option>`).join("");
}

function paymentOptions() {
  return providers.map((provider, index) => {
    const labels = { STRIPE: "Card", PAYPAL: "PayPal", MANUAL: "Manual payment" };
    return `
      <label class="commerce-payment-choice">
        <input type="radio" name="provider" value="${escapeHtml(provider.provider)}" ${index === 0 ? "checked" : ""} />
        <span><strong>${escapeHtml(labels[provider.provider] || provider.provider)}</strong>${provider.provider === "MANUAL" && provider.instructions ? `<small>${escapeHtml(provider.instructions)}</small>` : ""}</span>
      </label>
    `;
  }).join("");
}

function checkoutMarkup(message = "", error = false) {
  return `
    <form class="commerce-dialog-shell" data-commerce-checkout-form>
      <header class="commerce-dialog-header">
        <div><p>Secure checkout</p><h2>Contact and delivery</h2></div>
        ${closeButton()}
      </header>
      <div class="commerce-checkout-fields">
        <label><span>Name</span><input name="customerName" autocomplete="name" maxlength="120" /></label>
        <label><span>Email</span><input name="customerEmail" type="email" autocomplete="email" required /></label>
        <label><span>Phone</span><input name="customerPhone" type="tel" autocomplete="tel" maxlength="80" /></label>
        ${shippingZones.length ? `
          <label><span>Delivery country</span><select name="shippingCountry" data-commerce-country aria-label="Delivery country" required><option value="">Choose country</option>${countryOptions()}</select></label>
          <label class="commerce-full-field"><span>Address</span><input name="shippingLine1" autocomplete="address-line1" maxlength="160" required /></label>
          <label class="commerce-full-field"><span>Address line 2</span><input name="shippingLine2" autocomplete="address-line2" maxlength="160" /></label>
          <label><span>City</span><input name="shippingCity" autocomplete="address-level2" maxlength="120" required /></label>
          <label><span>Region</span><input name="shippingRegion" autocomplete="address-level1" maxlength="120" /></label>
          <label><span>Postal code</span><input name="shippingPostalCode" autocomplete="postal-code" maxlength="40" required /></label>
        ` : ""}
        <label><span>Coupon code</span><input name="couponCode" autocomplete="off" maxlength="80" /></label>
      </div>
      ${shippingZones.length ? '<div data-commerce-shipping-rates></div>' : ""}
      <fieldset class="commerce-payment-options">
        <legend>Payment</legend>
        ${providers.length ? paymentOptions() : '<p class="commerce-message error">This shop has not enabled a payment method yet.</p>'}
      </fieldset>
      <div class="commerce-checkout-total"><span>Current subtotal</span><strong>${escapeHtml(money(cart?.subtotalCents, cart?.currency))}</strong></div>
      <p class="commerce-message${error ? " error" : ""}" data-commerce-message aria-live="polite">${escapeHtml(message)}</p>
      <button type="submit" ${providers.length ? "" : "disabled"}>Review and pay</button>
      <button type="button" class="secondary-button" data-commerce-back-to-cart>Back to cart</button>
    </form>
  `;
}

function shippingRateMarkup(country) {
  const zone = shippingZones.find((candidate) => (candidate.countries || []).includes(country)) ||
    shippingZones.find((candidate) => !candidate.countries?.length);
  if (!zone?.rates?.length) return '<p class="commerce-message error">Delivery is not available for this country.</p>';

  return `
    <fieldset class="commerce-shipping-options">
      <legend>Delivery</legend>
      ${zone.rates.map((rate, index) => `
        <label class="commerce-payment-choice">
          <input type="radio" name="shippingRateId" value="${escapeHtml(rate.id)}" ${index === 0 ? "checked" : ""} />
          <span><strong>${escapeHtml(rate.name)}</strong><small>${escapeHtml(money(rate.priceCents, cart?.currency))}</small></span>
        </label>
      `).join("")}
    </fieldset>
  `;
}

function quoteMarkup(productId, productName, message = "", error = false) {
  return `
    <form class="commerce-dialog-shell" data-commerce-quote-form data-product-id="${escapeHtml(productId)}" data-product-name="${escapeHtml(productName)}">
      <header class="commerce-dialog-header">
        <div><p>Product inquiry</p><h2>Request a quote</h2><span>${escapeHtml(productName)}</span></div>
        ${closeButton()}
      </header>
      <div class="commerce-checkout-fields">
        <input type="hidden" name="startedAt" value="${escapeHtml(new Date().toISOString())}" />
        <label><span>Name</span><input name="name" autocomplete="name" maxlength="120" required /></label>
        <label><span>Email</span><input name="email" type="email" autocomplete="email" required /></label>
        <label><span>Phone</span><input name="phone" type="tel" autocomplete="tel" maxlength="80" /></label>
        <label class="commerce-full-field"><span>What do you need?</span><textarea name="message" rows="5" maxlength="5000" required></textarea></label>
      </div>
      <p class="commerce-message${error ? " error" : ""}" data-commerce-message aria-live="polite">${escapeHtml(message)}</p>
      <button type="submit">Send quote request</button>
    </form>
  `;
}

async function openCart(message = "") {
  openDialog();
  ensureDialog().innerHTML = '<div class="commerce-loading">Loading cart...</div>';
  try {
    await ensureCart();
    dialog.innerHTML = cartMarkup(message);
  } catch (error) {
    dialog.innerHTML = cartMarkup(error instanceof Error ? error.message : "Unable to load cart.");
  }
}

async function addProduct(input) {
  const currentCart = await ensureCart();
  const result = await request(`/orders/carts/${encodeURIComponent(currentCart.sessionToken)}/items`, {
    method: "POST",
    body: JSON.stringify(input)
  });
  setCart(result.cart);
}

async function changeQuantity(itemId, quantity) {
  const result = await request(`/orders/carts/${encodeURIComponent(cart.sessionToken)}/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify({ quantity })
  });
  setCart(result.cart);
  dialog.innerHTML = cartMarkup();
}

async function removeItem(itemId) {
  const result = await request(`/orders/carts/${encodeURIComponent(cart.sessionToken)}/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE"
  });
  setCart(result.cart);
  dialog.innerHTML = cartMarkup();
}

function loadStripe() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.addEventListener("load", () => resolve(window.Stripe), { once: true });
    script.addEventListener("error", () => reject(new Error("Card payment could not be loaded.")), { once: true });
    document.head.append(script);
  });
}

function completionMarkup(order, title, message) {
  return `
    <div class="commerce-dialog-shell commerce-complete">
      <header class="commerce-dialog-header"><div><p>Order ${escapeHtml(order.orderNumber)}</p><h2>${escapeHtml(title)}</h2></div>${closeButton()}</header>
      <p>${escapeHtml(message)}</p>
      <div class="commerce-order-total"><span>Total</span><strong>${escapeHtml(money(order.totalCents, order.currency))}</strong></div>
      <div class="commerce-complete-actions"><a class="secondary-button" href="${escapeHtml(localizedCommercePath("/account/orders"))}">View your order</a><a class="secondary-button" href="${escapeHtml(localizedCommercePath("/shop"))}">Continue shopping</a></div>
    </div>
  `;
}

function paymentRetryMarkup(order, provider, message) {
  const labels = { STRIPE: "card", PAYPAL: "PayPal", MANUAL: "manual payment" };
  return `
    <div class="commerce-dialog-shell commerce-complete">
      <header class="commerce-dialog-header"><div><p>Order ${escapeHtml(order.orderNumber)}</p><h2>Payment needs attention</h2></div>${closeButton()}</header>
      <p class="commerce-message error">${escapeHtml(message)}</p>
      <div class="commerce-order-total"><span>Order total</span><strong>${escapeHtml(money(order.totalCents, order.currency))}</strong></div>
      <button type="button" data-commerce-retry-payment="${escapeHtml(provider)}">Try ${escapeHtml(labels[provider] || "payment")} again</button>
      <a class="secondary-button" href="${escapeHtml(localizedCommercePath("/shop"))}">Continue shopping</a>
    </div>
  `;
}

async function prepareStripePayment(order, paymentData) {
  const Stripe = await loadStripe();
  stripe = Stripe(paymentData.providerPayload.publishableKey);
  stripeElements = stripe.elements({ clientSecret: paymentData.providerPayload.clientSecret });
  dialog.innerHTML = `
    <form class="commerce-dialog-shell" data-commerce-stripe-form>
      <header class="commerce-dialog-header"><div><p>Order ${escapeHtml(order.orderNumber)}</p><h2>Card payment</h2></div>${closeButton()}</header>
      <div class="commerce-order-total"><span>Total</span><strong>${escapeHtml(money(order.totalCents, order.currency))}</strong></div>
      <div class="commerce-stripe-element" data-commerce-stripe-element></div>
      <p class="commerce-message" data-commerce-message aria-live="polite"></p>
      <button type="submit">Pay securely</button>
    </form>
  `;
  stripeElements.create("payment").mount(dialog.querySelector("[data-commerce-stripe-element]"));
}

async function startPayment(order, provider) {
  const existing = pendingOrder();
  const idempotencyKey = existing?.order?.id === order.id && existing?.provider === provider
    ? existing.idempotencyKey || crypto.randomUUID()
    : crypto.randomUUID();
  const returnUrl = new URL(localizedCommercePath("/shop"), window.location.origin);
  returnUrl.searchParams.set("codey_payment", provider.toLowerCase());
  returnUrl.searchParams.set("orderId", order.id);
  sessionStorage.setItem(orderStorageKey, JSON.stringify({ order, provider, idempotencyKey }));
  const result = await request("/payments/intent", {
    method: "POST",
    body: JSON.stringify({
      orderId: order.id,
      provider,
      idempotencyKey,
      ...(provider === "PAYPAL" ? {
        returnUrl: returnUrl.toString(),
        cancelUrl: new URL(`${localizedCommercePath("/shop")}?codey_payment=cancelled`, window.location.origin).toString()
      } : {})
    })
  });
  if (provider === "PAYPAL") {
    window.location.assign(result.providerPayload.approveUrl);
    return;
  }
  if (provider === "STRIPE") {
    await prepareStripePayment(order, result);
    return;
  }

  sessionStorage.removeItem(orderStorageKey);
  dialog.innerHTML = completionMarkup(
    order,
    "Order received",
    result.providerPayload.instructions || "Follow the payment instructions provided by the shop."
  );
}

async function checkout(form) {
  const formData = new FormData(form);
  const message = form.querySelector("[data-commerce-message]");
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  message.textContent = "Confirming stock, discounts, delivery, and tax...";

  let createdOrder = null;
  let provider = "MANUAL";
  try {
    if (shippingZones.length && !formData.get("shippingRateId")) {
      throw new Error("Choose an available delivery method.");
    }
    const result = await request(`/orders/carts/${encodeURIComponent(cart.sessionToken)}/checkout`, {
      method: "POST",
      body: JSON.stringify({
        customerName: String(formData.get("customerName") || "").trim() || undefined,
        customerEmail: String(formData.get("customerEmail") || "").trim(),
        customerPhone: String(formData.get("customerPhone") || "").trim() || undefined,
        shippingCountry: String(formData.get("shippingCountry") || "").trim() || undefined,
        shippingAddress: shippingZones.length ? {
          line1: String(formData.get("shippingLine1") || "").trim(),
          line2: String(formData.get("shippingLine2") || "").trim() || undefined,
          city: String(formData.get("shippingCity") || "").trim(),
          region: String(formData.get("shippingRegion") || "").trim() || undefined,
          postalCode: String(formData.get("shippingPostalCode") || "").trim()
        } : undefined,
        shippingRateId: String(formData.get("shippingRateId") || "").trim() || undefined,
        couponCode: String(formData.get("couponCode") || "").trim() || undefined
      })
    });
    createdOrder = result.order;
    provider = String(formData.get("provider") || "MANUAL");
    clearCart();
    await startPayment(createdOrder, provider);
  } catch (error) {
    if (createdOrder) {
      const pending = pendingOrder();
      if (pending?.order?.id !== createdOrder.id || pending?.provider !== provider) {
        sessionStorage.setItem(orderStorageKey, JSON.stringify({
          order: createdOrder,
          provider,
          idempotencyKey: crypto.randomUUID()
        }));
      }
      dialog.innerHTML = paymentRetryMarkup(
        createdOrder,
        provider,
        error instanceof Error ? error.message : "Payment could not be started."
      );
      return;
    }
    message.textContent = error instanceof Error ? error.message : "Checkout could not be completed.";
    message.classList.add("error");
    submit.disabled = false;
  }
}

async function submitQuote(form) {
  const formData = new FormData(form);
  const message = form.querySelector("[data-commerce-message]");
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  message.textContent = "Sending your request...";
  try {
    await request("/cms/forms/contact", {
      method: "POST",
      body: JSON.stringify({
        formKey: "product-quote",
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        phone: String(formData.get("phone") || "").trim() || undefined,
        subject: `Quote request: ${form.dataset.productName}`,
        message: String(formData.get("message") || "").trim(),
        startedAt: String(formData.get("startedAt") || ""),
        metadata: {
          productId: form.dataset.productId,
          productName: form.dataset.productName,
          page: window.location.pathname
        }
      })
    });
    dialog.innerHTML = `
      <div class="commerce-dialog-shell commerce-complete">
        <header class="commerce-dialog-header"><div><p>Quote request</p><h2>Request received</h2></div>${closeButton()}</header>
        <p>The shop has received your request for ${escapeHtml(form.dataset.productName)}.</p>
        <button type="button" class="secondary-button" data-commerce-close>Continue browsing</button>
      </div>
    `;
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "Your quote request could not be sent.";
    message.classList.add("error");
    submit.disabled = false;
  }
}

async function resumePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get("codey_payment");
  if (!payment) return;
  openDialog();
  dialog.innerHTML = '<div class="commerce-loading">Confirming payment...</div>';
  const pending = pendingOrder();

  try {
    if (payment === "paypal" && pending?.order?.id && params.get("token")) {
      await request("/payments/paypal/capture", {
        method: "POST",
        body: JSON.stringify({ orderId: pending.order.id, providerReference: params.get("token") })
      });
      sessionStorage.removeItem(orderStorageKey);
      dialog.innerHTML = completionMarkup(pending.order, "Payment complete", "Your order is confirmed and the shop has been notified.");
    } else if (payment === "stripe" && params.get("redirect_status") === "succeeded" && pending?.order) {
      sessionStorage.removeItem(orderStorageKey);
      dialog.innerHTML = completionMarkup(pending.order, "Payment submitted", "Your payment is being confirmed securely.");
    } else {
      dialog.innerHTML = pending?.order
        ? paymentRetryMarkup(
            pending.order,
            pending.provider,
            payment === "cancelled" ? "Payment was cancelled. Your order is reserved for a short time." : "Payment could not be confirmed."
          )
        : cartMarkup("Payment could not be confirmed.");
    }
  } catch (error) {
    dialog.innerHTML = pending?.order
      ? paymentRetryMarkup(pending.order, pending.provider, error instanceof Error ? error.message : "Payment could not be confirmed.")
      : cartMarkup(error instanceof Error ? error.message : "Payment could not be confirmed.");
  } finally {
    const cleanUrl = new URL(window.location.href);
    ["codey_payment", "orderId", "token", "PayerID", "payment_intent", "payment_intent_client_secret", "redirect_status"].forEach((key) => cleanUrl.searchParams.delete(key));
    window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }
}

function bindCommerceEvents() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-buyer-refresh]")) {
      void loadBuyerOrders().catch((error) => renderBuyerOrders([], error.message));
      return;
    }
    if (event.target.closest("[data-buyer-forget]")) {
      openDialog();
      dialog.innerHTML = forgetBuyerSessionMarkup();
      return;
    }
    const cancelButton = event.target.closest("[data-buyer-cancel]");
    if (cancelButton) {
      openDialog();
      dialog.innerHTML = cancellationMarkup(cancelButton.dataset.buyerCancel);
      return;
    }
    const supportButton = event.target.closest("[data-buyer-support]");
    if (supportButton) {
      openDialog();
      dialog.innerHTML = supportCaseMarkup(supportButton.dataset.buyerSupport);
      return;
    }
    const refundButton = event.target.closest("[data-buyer-refund]");
    if (refundButton) {
      openDialog();
      dialog.innerHTML = refundRequestMarkup(
        refundButton.dataset.buyerRefund,
        Number.parseInt(refundButton.dataset.refundMaxCents || "0", 10),
        refundButton.dataset.refundCurrency || "EUR"
      );
      return;
    }
    if (event.target.closest("[data-commerce-close]")) {
      dialog?.close();
      return;
    }
    if (event.target.closest("[data-commerce-cart-toggle]")) {
      void openCart();
      return;
    }
    const addButton = event.target.closest("[data-commerce-add]");
    if (addButton) {
      addButton.disabled = true;
      void addProduct({ productId: addButton.dataset.productId, quantity: 1 })
        .then(() => openCart(`${addButton.dataset.productName} was added.`))
        .catch((error) => openCart(error.message))
        .finally(() => { addButton.disabled = false; });
      return;
    }
    const quoteButton = event.target.closest("[data-commerce-quote]");
    if (quoteButton) {
      openDialog();
      dialog.innerHTML = quoteMarkup(quoteButton.dataset.productId, quoteButton.dataset.productName);
      return;
    }
    if (event.target.closest("[data-commerce-start-checkout]")) {
      dialog.innerHTML = checkoutMarkup();
      return;
    }
    if (event.target.closest("[data-commerce-back-to-cart]")) {
      dialog.innerHTML = cartMarkup();
      return;
    }
    const retryButton = event.target.closest("[data-commerce-retry-payment]");
    if (retryButton) {
      const pending = pendingOrder();
      if (!pending?.order) return;
      retryButton.disabled = true;
      void startPayment(pending.order, retryButton.dataset.commerceRetryPayment)
        .catch((error) => {
          dialog.innerHTML = paymentRetryMarkup(pending.order, pending.provider, error.message);
        });
      return;
    }
    const removeButton = event.target.closest("[data-commerce-remove-item]");
    if (removeButton) void removeItem(removeButton.dataset.commerceRemoveItem).catch((error) => openCart(error.message));
  });

  document.addEventListener("change", (event) => {
    const quantity = event.target.closest("[data-commerce-item-quantity]");
    if (quantity) {
      void changeQuantity(quantity.dataset.commerceItemQuantity, Number(quantity.value)).catch((error) => openCart(error.message));
      return;
    }
    const country = event.target.closest("[data-commerce-country]");
    if (country) {
      const rates = dialog?.querySelector("[data-commerce-shipping-rates]");
      if (rates) rates.innerHTML = country.value ? shippingRateMarkup(country.value) : "";
      return;
    }
    const variant = event.target.closest('[data-commerce-product-form] select[name="variantId"]');
    if (variant) {
      const selected = variant.selectedOptions[0];
      const form = variant.closest("[data-commerce-product-form]");
      const price = form?.closest(".shop-product-detail-hero")?.querySelector("[data-commerce-product-price]");
      const quantityField = form?.querySelector('input[name="quantity"]');
      if (price) price.textContent = money(selected?.dataset.priceCents, form.dataset.productCurrency);
      if (quantityField) quantityField.max = selected?.dataset.stock || "1";
    }
  });

  document.addEventListener("submit", (event) => {
    const forgetForm = event.target.closest("[data-buyer-forget-form]");
    if (forgetForm) {
      event.preventDefault();
      const submit = forgetForm.querySelector('button[type="submit"]');
      const message = forgetForm.querySelector("[data-commerce-message]");
      submit.disabled = true;
      message.textContent = "Removing saved order access...";
      void request("/orders/buyer/session", { method: "DELETE" }).then(() => {
        dialog.close();
        renderBuyerOrders([], "This device no longer has access to saved orders.");
      }).catch((error) => {
        message.textContent = error.message;
        message.classList.add("error");
        submit.disabled = false;
      });
      return;
    }
    const claimForm = event.target.closest("[data-buyer-claim-form]");
    if (claimForm) {
      event.preventDefault();
      const data = new FormData(claimForm);
      const message = claimForm.querySelector("[data-commerce-message]");
      const submit = claimForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      message.textContent = "Verifying order...";
      void request("/orders/buyer/orders/claim", {
        method: "POST",
        body: JSON.stringify({
          orderNumber: String(data.get("orderNumber") || "").trim(),
          lookupToken: String(data.get("lookupToken") || "").trim()
        })
      }).then((result) => {
        renderBuyerOrders(result.orders || [], "Order added securely.");
        claimForm.reset();
        message.textContent = "Order added.";
      }).catch((error) => {
        message.textContent = error.message;
        message.classList.add("error");
      }).finally(() => { submit.disabled = false; });
      return;
    }
    const cancellationForm = event.target.closest("[data-buyer-cancel-form]");
    if (cancellationForm) {
      event.preventDefault();
      const data = new FormData(cancellationForm);
      const message = cancellationForm.querySelector("[data-commerce-message]");
      const submit = cancellationForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      message.textContent = "Checking the order...";
      void request(`/orders/buyer/orders/${encodeURIComponent(cancellationForm.dataset.orderNumber)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: String(data.get("reason") || "").trim() })
      }).then((result) => {
        const cancelled = result.cancellation?.action === "cancelled";
        dialog.close();
        return loadBuyerOrders(cancelled
          ? "Order cancelled and reserved stock was restored."
          : "Cancellation request sent to the shop.");
      }).catch((error) => {
        message.textContent = error.message;
        message.classList.add("error");
        submit.disabled = false;
      });
      return;
    }
    const supportForm = event.target.closest("[data-buyer-support-form]");
    if (supportForm) {
      event.preventDefault();
      const data = new FormData(supportForm);
      const message = supportForm.querySelector("[data-commerce-message]");
      const submit = supportForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      message.textContent = "Sending request...";
      void request(`/orders/buyer/orders/${encodeURIComponent(supportForm.dataset.orderNumber)}/cases`, {
        method: "POST",
        body: JSON.stringify({
          type: String(data.get("type") || "COMPLAINT"),
          subject: String(data.get("subject") || "").trim(),
          message: String(data.get("message") || "").trim()
        })
      }).then(() => {
        dialog.close();
        return loadBuyerOrders("Your request was sent to the shop.");
      }).catch((error) => {
        message.textContent = error.message;
        message.classList.add("error");
        submit.disabled = false;
      });
      return;
    }
    const refundForm = event.target.closest("[data-buyer-refund-form]");
    if (refundForm) {
      event.preventDefault();
      const data = new FormData(refundForm);
      const message = refundForm.querySelector("[data-commerce-message]");
      const submit = refundForm.querySelector('button[type="submit"]');
      const requestedRefundCents = Math.round(Number(String(data.get("amount") || "0").replace(",", ".")) * 100);
      const maxCents = Number.parseInt(refundForm.dataset.refundMaxCents || "0", 10);
      if (!Number.isInteger(requestedRefundCents) || requestedRefundCents <= 0 || requestedRefundCents > maxCents) {
        message.textContent = "Enter a refund amount within the available balance.";
        message.classList.add("error");
        return;
      }
      submit.disabled = true;
      message.textContent = "Sending refund request...";
      void request(`/orders/buyer/orders/${encodeURIComponent(refundForm.dataset.orderNumber)}/cases`, {
        method: "POST",
        body: JSON.stringify({
          type: "REFUND",
          subject: String(data.get("reason") || "Refund request"),
          message: String(data.get("message") || "").trim(),
          requestedRefundCents
        })
      }).then(() => {
        dialog.close();
        return loadBuyerOrders("Your refund request was sent to the shop.");
      }).catch((error) => {
        message.textContent = error.message;
        message.classList.add("error");
        submit.disabled = false;
      });
      return;
    }
    const productForm = event.target.closest("[data-commerce-product-form]");
    if (productForm) {
      event.preventDefault();
      if (productForm.dataset.purchaseMode === "quote") {
        openDialog();
        dialog.innerHTML = quoteMarkup(productForm.dataset.productId, productForm.dataset.productName);
        return;
      }
      const data = new FormData(productForm);
      const submit = productForm.querySelector('button[type="submit"]');
      const inlineMessage = productForm.querySelector("[data-commerce-inline-message]");
      submit.disabled = true;
      inlineMessage.textContent = "Adding...";
      void addProduct({
        productId: productForm.dataset.productId,
        variantId: String(data.get("variantId") || "") || undefined,
        quantity: Number(data.get("quantity") || 1)
      }).then(() => {
        inlineMessage.textContent = "Added to cart.";
        return openCart();
      }).catch((error) => {
        inlineMessage.textContent = error.message;
        inlineMessage.classList.add("error");
      }).finally(() => { submit.disabled = false; });
      return;
    }
    const checkoutForm = event.target.closest("[data-commerce-checkout-form]");
    if (checkoutForm) {
      event.preventDefault();
      void checkout(checkoutForm);
      return;
    }
    const quoteForm = event.target.closest("[data-commerce-quote-form]");
    if (quoteForm) {
      event.preventDefault();
      void submitQuote(quoteForm);
      return;
    }
    const stripeForm = event.target.closest("[data-commerce-stripe-form]");
    if (stripeForm) {
      event.preventDefault();
      const submit = stripeForm.querySelector('button[type="submit"]');
      const message = stripeForm.querySelector("[data-commerce-message]");
      submit.disabled = true;
      message.textContent = "Confirming payment...";
      void stripe.confirmPayment({
        elements: stripeElements,
        confirmParams: { return_url: new URL(`${localizedCommercePath("/shop")}?codey_payment=stripe`, window.location.origin).toString() },
        redirect: "if_required"
      }).then((result) => {
        if (result.error) throw new Error(result.error.message || "Card payment failed.");
        const pending = pendingOrder();
        sessionStorage.removeItem(orderStorageKey);
        dialog.innerHTML = completionMarkup(pending?.order || {}, "Payment submitted", "Your payment is being confirmed securely.");
      }).catch((error) => {
        message.textContent = error.message;
        message.classList.add("error");
        submit.disabled = false;
      });
    }
  });
}

export async function enhanceCommerce() {
  bindCommerceEvents();
  if (document.querySelector("[data-commerce-root]")) {
    const [providerResult, shippingResult] = await Promise.allSettled([
      request("/payments/providers/public"),
      request("/orders/shipping/zones")
    ]);
    providers = providerResult.status === "fulfilled" ? providerResult.value.providers || [] : [];
    shippingZones = shippingResult.status === "fulfilled" ? shippingResult.value.zones || [] : [];

    const token = cartToken();
    if (token) {
      try {
        setCart((await request(`/orders/carts/${encodeURIComponent(token)}`)).cart);
      } catch {
        clearCart();
      }
    } else {
      updateCartCounts();
    }

    await resumePaymentReturn();
  }

  if (document.querySelector("[data-commerce-account-root]")) {
    try {
      await loadBuyerOrders();
    } catch (error) {
      renderBuyerOrders([], error instanceof Error ? error.message : "Your orders could not be loaded.");
    }
  }
}
