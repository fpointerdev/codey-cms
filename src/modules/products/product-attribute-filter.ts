import type { Prisma } from "@prisma/client";

type ProductAttributeCandidate = {
  id: string;
  metadata: Prisma.JsonValue | null;
};

type AttributeFilter = {
  attributeName?: string;
  attributeValue?: string;
};

type AttributePageOptions = {
  skip: number;
  take: number;
  countTotal?: boolean;
  batchSize?: number;
};

type CandidateBatchLoader = (
  cursor: string | undefined,
  take: number
) => Promise<ProductAttributeCandidate[]>;

function normalizeAttribute(value: unknown) {
  const normalized: string[] = [];
  let separatorPending = false;

  for (const character of String(value || "").trim().toLowerCase()) {
    const code = character.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isLetter = code >= 97 && code <= 122;
    if (!isDigit && !isLetter) {
      separatorPending = normalized.length > 0;
      continue;
    }

    if (separatorPending) normalized.push("-");
    normalized.push(character);
    separatorPending = false;
  }

  return normalized.join("");
}

export function productMatchesAttributeFilter(
  product: Pick<ProductAttributeCandidate, "metadata">,
  filter: AttributeFilter
) {
  if (!filter.attributeName && !filter.attributeValue) return true;

  const metadata = product.metadata && typeof product.metadata === "object" && !Array.isArray(product.metadata)
    ? product.metadata as Record<string, unknown>
    : {};
  const attributes = Array.isArray(metadata.attributes) ? metadata.attributes : [];
  const normalizedName = normalizeAttribute(filter.attributeName);
  const normalizedValue = normalizeAttribute(filter.attributeValue);

  return attributes.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;

    const attribute = item as Record<string, unknown>;
    const name = normalizeAttribute(attribute.name);
    const value = normalizeAttribute(attribute.value);

    return (!normalizedName || name === normalizedName) && (!normalizedValue || value === normalizedValue);
  });
}

export async function findProductAttributePage(
  loadBatch: CandidateBatchLoader,
  filter: AttributeFilter,
  options: AttributePageOptions
) {
  const batchSize = options.batchSize ?? 250;
  const ids: string[] = [];
  let cursor: string | undefined;
  let total = 0;

  while (true) {
    const candidates = await loadBatch(cursor, batchSize);
    if (!candidates.length) break;

    for (const candidate of candidates) {
      if (!productMatchesAttributeFilter(candidate, filter)) continue;

      if (total >= options.skip && ids.length < options.take) ids.push(candidate.id);
      total += 1;
    }

    cursor = candidates.at(-1)?.id;
    if (!options.countTotal && ids.length >= options.take) break;
    if (candidates.length < batchSize) break;
  }

  return { ids, total };
}

export function orderProductsByIds<T extends { id: string }>(products: T[], ids: string[]) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return ids.flatMap((id) => {
    const product = productsById.get(id);
    return product ? [product] : [];
  });
}
