export type CustomCodeValue = {
  html: string;
  css: string;
  javascript: string;
  libraries: string[];
  height: number;
};

export type CustomCodeValidationIssue = {
  code: string;
  message: string;
};

export const customCodeContentSecurityPolicy = [
  "sandbox allow-scripts allow-forms",
  "default-src 'none'",
  "script-src 'unsafe-inline' https:",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "connect-src https:",
  "media-src blob: https:",
  "frame-src https:",
  "form-action https:",
  "object-src 'none'",
  "base-uri 'none'"
].join("; ");

export function validateCustomCodeValue(value: unknown) {
  const errors: CustomCodeValidationIssue[] = [];
  const maximumLengths = {
    html: 100_000,
    css: 50_000,
    javascript: 100_000
  } as const;

  if (typeof value === "string") {
    if (!value.trim()) {
      errors.push(issue("empty_custom_code", "Custom code needs HTML content."));
    } else if (value.length > maximumLengths.html) {
      errors.push(issue("custom_code_too_large", "Custom code HTML must be 100,000 characters or fewer."));
    }
    return { errors };
  }

  if (!isRecord(value)) {
    errors.push(issue("invalid_custom_code", "Custom code needs structured HTML, CSS, and JavaScript fields."));
    return { errors };
  }

  const allowedKeys = new Set(["html", "css", "javascript", "libraries", "height"]);
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    errors.push(issue("invalid_custom_code_field", `Custom code field ${unknownKey} is not supported.`));
  }

  for (const [field, maximumLength] of Object.entries(maximumLengths)) {
    const fieldValue = value[field];
    if (fieldValue !== undefined && typeof fieldValue !== "string") {
      errors.push(issue("invalid_custom_code_field", `Custom code ${field} must be text.`));
    } else if (typeof fieldValue === "string" && fieldValue.length > maximumLength) {
      errors.push(issue("custom_code_too_large", `Custom code ${field} is too large.`));
    }
  }

  const libraries = value.libraries;
  if (libraries !== undefined && !Array.isArray(libraries)) {
    errors.push(issue("invalid_custom_code_libraries", "Custom code libraries must be a list of HTTPS URLs."));
  } else if (Array.isArray(libraries)) {
    if (libraries.length > 12) {
      errors.push(issue("too_many_custom_code_libraries", "Custom code supports up to 12 external libraries."));
    }

    for (const library of libraries) {
      if (typeof library !== "string" || !isSecureLibraryUrl(library)) {
        errors.push(issue("invalid_custom_code_library", "Each custom code library must use an HTTPS URL without credentials."));
        break;
      }
    }
  }

  if (value.height !== undefined && (
    typeof value.height !== "number" ||
    !Number.isInteger(value.height) ||
    value.height < 120 ||
    value.height > 1200
  )) {
    errors.push(issue("invalid_custom_code_height", "Custom code height must be a whole number from 120 to 1200 pixels."));
  }

  if (value.html === undefined || typeof value.html === "string" && !value.html.trim()) {
    errors.push(issue("empty_custom_code", "Custom code needs HTML content."));
  }

  return { errors };
}

export function normalizeCustomCodeValue(value: unknown): CustomCodeValue {
  if (typeof value === "string") {
    return { html: value, css: "", javascript: "", libraries: [], height: 320 };
  }

  if (!isRecord(value)) {
    return { html: "", css: "", javascript: "", libraries: [], height: 320 };
  }

  return {
    html: typeof value.html === "string" ? value.html : "",
    css: typeof value.css === "string" ? value.css : "",
    javascript: typeof value.javascript === "string" ? value.javascript : "",
    libraries: Array.isArray(value.libraries)
      ? value.libraries.filter((library): library is string => typeof library === "string" && isSecureLibraryUrl(library)).slice(0, 12)
      : [],
    height: typeof value.height === "number" && Number.isInteger(value.height)
      ? Math.min(1200, Math.max(120, value.height))
      : 320
  };
}

export function renderCustomCodeDocument(value: unknown, options: { title?: string; locale?: string } = {}) {
  const code = normalizeCustomCodeValue(value);
  const libraries = code.libraries
    .map((url) => `<script src="${escapeAttribute(new URL(url).href)}"></script>`)
    .join("");

  return `<!doctype html>
<html lang="${escapeAttribute(options.locale || "en")}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(options.title || "Custom code")}</title>
    <style>html { color-scheme: light dark; } body { margin: 0; }${code.css}</style>
  </head>
  <body>
    ${code.html}
    ${libraries}
    ${code.javascript ? `<script>${code.javascript}</script>` : ""}
  </body>
</html>`;
}

function issue(code: string, message: string): CustomCodeValidationIssue {
  return { code, message };
}

function isSecureLibraryUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll("'", "&#039;");
}
