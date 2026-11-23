import { z } from "zod";

// Missing PATCH fields must not acquire the defaults used during creation.
export function patchSchema<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([key, value]) => [
    key, z.union([z.undefined(), value]).optional()
  ])) as { [K in keyof T]: z.ZodOptional<z.ZodUnion<[z.ZodUndefined, T[K]]>> };
  return schema.extend(shape);
}
