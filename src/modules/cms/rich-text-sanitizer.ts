import sanitizeHtml from "sanitize-html";

const richTextKeys = new Set(["body", "caption", "content", "copy", "description", "text"]);

export function sanitizeRichText(value: string) {
  if (!/<[a-z!/]/i.test(value)) return value;

  return sanitizeHtml(value, {
    allowedTags: [
      "a",
      "blockquote",
      "br",
      "code",
      "em",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "li",
      "ol",
      "p",
      "pre",
      "s",
      "span",
      "strong",
      "u",
      "ul"
    ],
    allowedAttributes: {
      a: ["href"]
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard"
  });
}

export function sanitizeRichObject<T>(value: T): T {
  return sanitizeNestedValue(value) as T;
}

export function sanitizePostContent<T>(content: T): T {
  if (!isRecord(content)) return content;

  return {
    ...content,
    ...(typeof content.body === "string" ? { body: sanitizeRichText(content.body) } : {})
  };
}

export function sanitizeContentBlockValue<T>(type: string, value: T): T {
  if (type === "RICH_TEXT" && typeof value === "string") {
    return sanitizeRichText(value) as T;
  }

  if (!isRecord(value) && !Array.isArray(value)) return value;
  const sanitized = sanitizeNestedValue(value);

  if (type === "PRODUCT_LIST" && isRecord(sanitized)) {
    const { products: _runtimeProducts, ...persistedValue } = sanitized;
    return persistedValue as T;
  }

  return sanitized as T;
}

function sanitizeNestedValue(value: unknown, key?: string): unknown {
  if (typeof value === "string") {
    return key && richTextKeys.has(key) ? sanitizeRichText(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNestedValue(item));
  }

  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeNestedValue(entryValue, entryKey)
    ])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
