import type { Prisma, PrismaClient } from "@prisma/client";

type LocalizationDatabase = PrismaClient | Prisma.TransactionClient;

export type LocaleConfig = {
  code: string;
  label: string;
  enabled: boolean;
};

export type LocalizationSettings = {
  enabled: boolean;
  defaultLocale: string;
  fallbackLocale: string;
  locales: LocaleConfig[];
  urlMode: "prefix";
  showLanguageSwitcher: boolean;
  languageSwitcherDisplay: "buttons" | "dropdown";
  languageSwitcherLabelStyle: "full" | "code" | "icon";
  strings: Record<string, Record<string, string>>;
};

const defaultLocale = {
  code: "en",
  label: "English",
  enabled: true
};

const defaultSettings: LocalizationSettings = {
  enabled: false,
  defaultLocale: defaultLocale.code,
  fallbackLocale: defaultLocale.code,
  locales: [defaultLocale],
  urlMode: "prefix",
  showLanguageSwitcher: false,
  languageSwitcherDisplay: "buttons",
  languageSwitcherLabelStyle: "full",
  strings: {}
};

export function normalizeLocale(value: unknown) {
  return parseLocaleCode(value) ?? defaultSettings.defaultLocale;
}

export function publicLocaleCodes(settings: LocalizationSettings) {
  const defaultLocaleCode = normalizeLocale(settings.defaultLocale);
  if (!settings.enabled) return [defaultLocaleCode];

  const locales = new Set([defaultLocaleCode]);
  settings.locales
    .filter((locale) => locale.enabled)
    .forEach((locale) => locales.add(normalizeLocale(locale.code)));
  return [...locales];
}

function parseLocaleCode(value: unknown) {
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase().replace("_", "-");
  return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(normalized) ? normalized : undefined;
}

function localeLabel(locale: string) {
  return locale
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function parseLocales(value: unknown, defaultLocaleCode: string) {
  if (!Array.isArray(value)) return [{ ...defaultLocale, code: defaultLocaleCode }];

  const locales = value.flatMap((item): LocaleConfig[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const code = parseLocaleCode(record.code);

    if (!code) return [];

    return [
      {
        code,
        label: typeof record.label === "string" && record.label.trim()
          ? record.label.trim()
          : localeLabel(code),
        enabled: record.enabled !== false
      }
    ];
  });
  const uniqueLocales = new Map(locales.map((locale) => [locale.code, locale]));

  if (!uniqueLocales.has(defaultLocaleCode)) {
    uniqueLocales.set(defaultLocaleCode, {
      code: defaultLocaleCode,
      label: localeLabel(defaultLocaleCode),
      enabled: true
    });
  }

  return [...uniqueLocales.values()];
}

function validStringKey(value: string) {
  return /^[a-z][a-z0-9_.-]{1,120}$/i.test(value);
}

function normalizeStringText(value: unknown) {
  if (typeof value !== "string") return "";

  return value.trim().slice(0, 1000);
}

function addTranslationString(
  strings: Record<string, Record<string, string>>,
  localeCodes: Set<string>,
  key: unknown,
  locale: unknown,
  text: unknown
) {
  if (typeof key !== "string" || !validStringKey(key.trim())) return;

  const localeCode = parseLocaleCode(locale);
  if (!localeCode || !localeCodes.has(localeCode)) return;

  const normalizedText = normalizeStringText(text);
  if (!normalizedText) return;

  const stringKey = key.trim();
  strings[stringKey] = {
    ...(strings[stringKey] ?? {}),
    [localeCode]: normalizedText
  };
}

function parseTranslationStrings(value: unknown, locales: LocaleConfig[]) {
  const strings: Record<string, Record<string, string>> = {};
  const localeCodes = new Set(locales.map((locale) => locale.code));

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;

      const record = item as Record<string, unknown>;
      addTranslationString(strings, localeCodes, record.key, record.locale, record.text ?? record.value);
    }

    return strings;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) return strings;

  for (const [key, translations] of Object.entries(value as Record<string, unknown>)) {
    if (!translations || typeof translations !== "object" || Array.isArray(translations)) continue;

    for (const [locale, text] of Object.entries(translations as Record<string, unknown>)) {
      addTranslationString(strings, localeCodes, key, locale, text);
    }
  }

  return strings;
}

function parseLanguageSwitcherDisplay(value: unknown): LocalizationSettings["languageSwitcherDisplay"] {
  return value === "dropdown" ? "dropdown" : "buttons";
}

function parseLanguageSwitcherLabelStyle(value: unknown): LocalizationSettings["languageSwitcherLabelStyle"] {
  return value === "code" || value === "icon" ? value : "full";
}

export function normalizeLocalizationSettings(value: unknown, moduleEnabled = false): LocalizationSettings {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const defaultLocaleCode = parseLocaleCode(stored.defaultLocale) ?? defaultSettings.defaultLocale;
  const locales = parseLocales(stored.locales, defaultLocaleCode);
  const enabledLocales = locales.filter((locale) => locale.enabled);
  const fallbackLocale = parseLocaleCode(stored.fallbackLocale);

  return {
    enabled: moduleEnabled && stored.enabled !== false,
    defaultLocale: defaultLocaleCode,
    fallbackLocale: fallbackLocale && enabledLocales.some((locale) => locale.code === fallbackLocale)
      ? fallbackLocale
      : defaultLocaleCode,
    locales,
    urlMode: "prefix",
    showLanguageSwitcher: stored.showLanguageSwitcher === true,
    languageSwitcherDisplay: parseLanguageSwitcherDisplay(stored.languageSwitcherDisplay),
    languageSwitcherLabelStyle: parseLanguageSwitcherLabelStyle(stored.languageSwitcherLabelStyle),
    strings: parseTranslationStrings(stored.strings, locales)
  };
}

export async function readLocalizationSettings(prisma: LocalizationDatabase) {
  const database = prisma as LocalizationDatabase & {
    site?: LocalizationDatabase["site"];
    installedModule?: LocalizationDatabase["installedModule"];
    moduleSetting?: LocalizationDatabase["moduleSetting"];
  };

  if (!database.site?.findUnique || !database.installedModule?.findUnique || !database.moduleSetting?.findUnique) {
    return defaultSettings;
  }

  const site = await database.site.findUnique({
    where: {
      slug: "default"
    },
    select: {
      id: true
    }
  });

  if (!site) return defaultSettings;

  const [installedModule, setting] = await Promise.all([
    database.installedModule.findUnique({
      where: {
        siteId_moduleId: {
          siteId: site.id,
          moduleId: "localization"
        }
      },
      select: {
        status: true
      }
    }),
    database.moduleSetting.findUnique({
      where: {
        siteId_moduleId_key: {
          siteId: site.id,
          moduleId: "localization",
          key: "settings"
        }
      },
      select: {
        value: true
      }
    })
  ]);

  return normalizeLocalizationSettings(setting?.value, installedModule?.status === "ENABLED");
}

export function resolveLocale(settings: LocalizationSettings, requestedLocale: unknown) {
  if (!settings.enabled) return settings.defaultLocale;

  const normalized = normalizeLocale(requestedLocale);
  const enabledLocales = new Set(
    settings.locales
      .filter((locale) => locale.enabled)
      .map((locale) => locale.code)
  );

  return enabledLocales.has(normalized) ? normalized : settings.defaultLocale;
}

export function localizedPath(slug: string, locale: string, defaultLocaleCode = defaultSettings.defaultLocale) {
  const localeCode = normalizeLocale(locale);
  const normalizedSlug = slug === "home"
    ? ""
    : slug
        .replace(/^\/+|\/+$/g, "")
        .split("/")
        .filter(Boolean)
        .map((part) => encodeURIComponent(part))
        .join("/");
  const path = normalizedSlug ? `/${normalizedSlug}` : "/";

  if (localeCode === defaultLocaleCode) return path;
  return normalizedSlug ? `/${localeCode}/${normalizedSlug}` : `/${localeCode}`;
}
