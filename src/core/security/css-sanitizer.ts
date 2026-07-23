const unsafeCssPattern =
  /(@import|@namespace|expression\s*\(|url\s*\(|(?:-webkit-)?image-set\s*\(|javascript:|vbscript:|data:text\/html|(?:^|[;{])\s*behavior\s*:|-moz-binding|<\/?style|<!--|-->)/i;

export function sanitizeGeneratedStylesheet(value: unknown) {
  const css = typeof value === "string"
    ? value.replace(/<\/?style[^>]*>/gi, "").replace(/\/\*[\s\S]*?\*\//g, "").slice(0, 20_000).trim()
    : "";

  if (!css || /[<>]/.test(css) || unsafeCssPattern.test(css)) return "";
  return css;
}
