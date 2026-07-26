const unsafeCssPattern =
  /(@import|@namespace|expression\s*\(|url\s*\(|(?:-webkit-)?image-set\s*\(|javascript:|vbscript:|data:text\/html|(?:^|[;{])\s*behavior\s*:|-moz-binding|<\/?style|<!--|-->)/i;

export function sanitizeGeneratedStylesheet(value: unknown, maxLength = 20_000) {
  const css = typeof value === "string"
    ? value.replace(/<\/?style[^>]*>/gi, "").replace(/\/\*[\s\S]*?\*\//g, "").slice(0, maxLength).trim()
    : "";

  if (!css || css.includes("<") || unsafeCssPattern.test(css)) return "";
  return css;
}
