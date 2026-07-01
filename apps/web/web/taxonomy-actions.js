import { api, setStatus, slugFromTitle } from "./core.js";
import { loadAdminRoute } from "./controller.js";
import { getModalFormHandler } from "./modal.js";

function categoryFields(category = {}) {
  return [
    { name: "name", label: "Name", value: category.name || "New category" },
    { name: "slug", label: "Slug", value: category.slug || slugFromTitle(category.name || "new-category") },
    { name: "description", label: "Description", type: "textarea", rows: 3, value: category.description || "", required: false },
    { name: "sortOrder", label: "Sort order", type: "number", value: category.sortOrder || 0, required: false }
  ];
}

function attributeFields(attribute = {}) {
  return [
    { name: "name", label: "Name", value: attribute.name || "New attribute" },
    { name: "slug", label: "Slug", value: attribute.slug || slugFromTitle(attribute.name || "new-attribute") },
    {
      name: "values",
      label: "Values",
      type: "textarea",
      rows: 4,
      value: (attribute.values || []).join(", "),
      required: false,
      help: "Comma-separated values used by frontend filters."
    },
    { name: "description", label: "Description", type: "textarea", rows: 3, value: attribute.description || "", required: false },
    { name: "sortOrder", label: "Sort order", type: "number", value: attribute.sortOrder || 0, required: false }
  ];
}

function categoryPayload(values) {
  return {
    name: values.name,
    slug: slugFromTitle(values.slug || values.name),
    description: values.description || "",
    sortOrder: Number.parseInt(values.sortOrder || "0", 10) || 0
  };
}

function attributePayload(values) {
  return {
    ...categoryPayload(values),
    values: String(values.values || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

async function confirmDelete(title, name) {
  const values = await getModalFormHandler()({
    label: "Delete",
    title,
    description: `This removes "${name}". Existing content will not be deleted, but links to this taxonomy may stop matching.`,
    fields: [
      { name: "confirm", label: "I understand", type: "checkbox", checked: false, required: false }
    ],
    submitLabel: "Delete"
  });

  return Boolean(values?.confirm);
}

export async function savePostCategory(slug = "") {
  const { categories } = await api("/cms/categories");
  const category = categories.find((item) => item.slug === slug) || {};
  const values = await getModalFormHandler()({
    label: "Post category",
    title: slug ? "Edit post category" : "Create post category",
    fields: categoryFields(category),
    submitLabel: slug ? "Save category" : "Create category"
  });
  if (!values) return;

  await api(slug ? `/cms/categories/${encodeURIComponent(slug)}` : "/cms/categories", {
    method: slug ? "PATCH" : "POST",
    body: JSON.stringify(categoryPayload(values))
  });
  await loadAdminRoute({ view: "post-categories" });
  setStatus(slug ? "Post category saved." : "Post category created.");
}

export async function deletePostCategory(slug) {
  const { categories } = await api("/cms/categories");
  const category = categories.find((item) => item.slug === slug);
  if (!category || !await confirmDelete("Delete post category", category.name)) return;

  await api(`/cms/categories/${encodeURIComponent(slug)}`, { method: "DELETE" });
  await loadAdminRoute({ view: "post-categories" });
  setStatus("Post category deleted.");
}

export async function saveProductCategory(slug = "") {
  const { categories } = await api("/products/categories");
  const category = categories.find((item) => item.slug === slug) || {};
  const values = await getModalFormHandler()({
    label: "Product category",
    title: slug ? "Edit product category" : "Create product category",
    fields: categoryFields(category),
    submitLabel: slug ? "Save category" : "Create category"
  });
  if (!values) return;

  await api(slug ? `/products/categories/${encodeURIComponent(slug)}` : "/products/categories", {
    method: slug ? "PATCH" : "POST",
    body: JSON.stringify(categoryPayload(values))
  });
  await loadAdminRoute({ view: "shop-categories" });
  setStatus(slug ? "Product category saved." : "Product category created.");
}

export async function deleteProductCategory(slug) {
  const { categories } = await api("/products/categories");
  const category = categories.find((item) => item.slug === slug);
  if (!category || !await confirmDelete("Delete product category", category.name)) return;

  await api(`/products/categories/${encodeURIComponent(slug)}`, { method: "DELETE" });
  await loadAdminRoute({ view: "shop-categories" });
  setStatus("Product category deleted.");
}

export async function saveProductAttribute(slug = "") {
  const { attributes } = await api("/products/attributes");
  const attribute = attributes.find((item) => item.slug === slug) || {};
  const values = await getModalFormHandler()({
    label: "Product attribute",
    title: slug ? "Edit product attribute" : "Create product attribute",
    fields: attributeFields(attribute),
    submitLabel: slug ? "Save attribute" : "Create attribute"
  });
  if (!values) return;

  await api(slug ? `/products/attributes/${encodeURIComponent(slug)}` : "/products/attributes", {
    method: slug ? "PATCH" : "POST",
    body: JSON.stringify(attributePayload(values))
  });
  await loadAdminRoute({ view: "shop-attributes" });
  setStatus(slug ? "Product attribute saved." : "Product attribute created.");
}

export async function deleteProductAttribute(slug) {
  const { attributes } = await api("/products/attributes");
  const attribute = attributes.find((item) => item.slug === slug);
  if (!attribute || !await confirmDelete("Delete product attribute", attribute.name)) return;

  await api(`/products/attributes/${encodeURIComponent(slug)}`, { method: "DELETE" });
  await loadAdminRoute({ view: "shop-attributes" });
  setStatus("Product attribute deleted.");
}

