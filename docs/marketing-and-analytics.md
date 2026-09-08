# Marketing and Analytics

Site owners configure measurement in **Settings > Marketing**. The configuration is stored with the site in the database and survives generated-site imports and signed CMS updates. No analytics setting belongs in `WebsiteSpec` or the deployment environment.

## Supported services

- Google Analytics 4: enter a `G-...` measurement ID.
- Google Tag Manager: enter a `GTM-...` container ID. Use the container for additional advertising or CRM tags.
- Plausible: enter the site domain registered in Plausible.
- Meta Pixel: optionally enter its numeric ID alongside any analytics provider.
- Google Search Console and Bing Webmaster Tools: enter only the verification token from each service's meta tag.

CodeY permits only these provider integrations. It does not paste arbitrary scripts into the main document. Provider IDs and verification tokens are public identifiers, not secrets, but only users with module-management permission can change them.

## Consent and privacy

**Ask before loading analytics** is the default. Until a visitor allows analytics, CodeY does not load a provider, create marketing attribution storage, or emit measurement events. A visitor can reopen the privacy choice after accepting or declining. Site owners remain responsible for their privacy notice and local legal requirements.

The optional immediate mode is intended only for configurations where the site owner has established that prior consent is not required.

CodeY records bounded first- and last-touch UTM values after consent. Referrers are reduced to a hostname. Form content, customer names, email addresses, addresses, authentication data, cart tokens, order lookup tokens, and payment details are never included.

## Event contract

The public runtime emits these stable events when their category is enabled:

| Event | Trigger |
| --- | --- |
| `page_view` | A public page is viewed. |
| `view_item` | A product detail is viewed. |
| `add_to_cart` | The server accepts a cart item. |
| `begin_checkout` | Checkout validation begins. |
| `purchase` | A manual order is accepted or a payment is confirmed through the CMS provider flow. |
| `generate_lead` | A contact or product-quote form succeeds. |

Trusted custom storefront code may call `window.codeyTrack(name, properties)`. Unknown event names, nested values, excessive properties, and oversized text are discarded. Do not pass personal data.

## Generator boundary

CodeY and other generators should leave the existing marketing settings unchanged. Generated pages automatically inherit verification metadata, consent behavior, attribution, and public events from the CMS runtime. A generator must not place provider IDs, consent decisions, customer data, or tracking scripts in `WebsiteSpec`.
