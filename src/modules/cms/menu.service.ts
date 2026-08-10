import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../core/errors/app-error.js";
import {
  localizedPath,
  normalizeLocale,
  readLocalizationSettings
} from "../localization/localization.service.js";

type MenuDatabase = PrismaClient | Prisma.TransactionClient;

export type MenuItemInput = {
  parentId?: string | null;
  pageId?: string | null;
  label: string;
  url?: string | null;
  sortOrder: number;
  openInNewTab: boolean;
};

const menuInclude = {
  items: {
    orderBy: {
      sortOrder: "asc"
    },
    include: {
      page: true
    }
  }
} as const;

function visibleMenuItems(
  items: Prisma.MenuItemGetPayload<{ include: { page: true } }>[],
  canReadDrafts: boolean,
  defaultLocale = "en"
) {
  const allowedItems = items.filter((item) => {
    if (!item.page) return true;
    return item.page.status === "PUBLISHED" || canReadDrafts;
  });
  const byParent = allowedItems.reduce<Map<string | null, typeof allowedItems>>((groups, item) => {
    const key = item.parentId ?? null;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
    return groups;
  }, new Map());

  const buildItems = (
    parentId: string | null,
    visited = new Set<string>()
  ): Array<Record<string, unknown>> =>
    (byParent.get(parentId) ?? []).flatMap((item) => {
      if (visited.has(item.id)) return [];

      const nextVisited = new Set(visited);
      nextVisited.add(item.id);
      return {
        id: item.id,
        label: item.label,
        url: item.url ?? (item.page ? localizedPath(item.page.slug, item.page.locale, defaultLocale) : null),
        pageId: item.pageId,
        sortOrder: item.sortOrder,
        openInNewTab: item.openInNewTab,
        children: buildItems(item.id, nextVisited)
      };
    });

  return buildItems(null);
}

export class MenuService {
  constructor(private readonly prisma: MenuDatabase) {}

  async create(input: { slug: string; name: string; location: string; locale?: string }) {
    return this.prisma.menu.create({
      data: {
        ...input,
        locale: normalizeLocale(input.locale)
      }
    });
  }

  async get(slug: string, canReadDrafts: boolean, locale = "en") {
    const [menu, localization] = await Promise.all([
      this.prisma.menu.findFirstOrThrow({
        where: {
          slug,
          locale: normalizeLocale(locale)
        },
        include: menuInclude
      }),
      readLocalizationSettings(this.prisma)
    ]);

    return {
      id: menu.id,
      slug: menu.slug,
      locale: menu.locale,
      name: menu.name,
      location: menu.location,
      items: visibleMenuItems(menu.items, canReadDrafts, localization.defaultLocale)
    };
  }

  async createItem(menuSlug: string, input: MenuItemInput, locale = "en") {
    const menu = await this.findMenu(menuSlug, locale);
    if (!input.url && !input.pageId) {
      throw new AppError(422, "invalid_menu_item", "Menu item needs a url or pageId.");
    }

    await this.assertParent(menu.id, input.parentId);
    return this.prisma.menuItem.create({
      data: {
        menuId: menu.id,
        parentId: input.parentId,
        pageId: input.pageId,
        label: input.label,
        url: input.url,
        sortOrder: input.sortOrder,
        openInNewTab: input.openInNewTab
      }
    });
  }

  async updateItem(menuSlug: string, itemId: string, input: Partial<MenuItemInput>, locale = "en") {
    const menu = await this.findMenu(menuSlug, locale);
    const item = await this.prisma.menuItem.findFirst({
      where: {
        id: itemId,
        menuId: menu.id
      }
    });
    if (!item) throw new AppError(404, "menu_item_not_found", "Menu item not found.");
    if (input.parentId === item.id) {
      throw new AppError(422, "invalid_menu_parent", "Menu item cannot be its own parent.");
    }

    await this.assertParent(menu.id, input.parentId, item.id);
    return this.prisma.menuItem.update({
      where: { id: item.id },
      data: input
    });
  }

  async deleteItem(menuSlug: string, itemId: string, locale = "en") {
    const menu = await this.findMenu(menuSlug, locale);
    const deleted = await this.prisma.menuItem.deleteMany({
      where: {
        id: itemId,
        menuId: menu.id
      }
    });
    if (deleted.count === 0) {
      throw new AppError(404, "menu_item_not_found", "Menu item not found.");
    }
  }

  private findMenu(slug: string, locale: string) {
    return this.prisma.menu.findFirstOrThrow({
      where: {
        slug,
        locale: normalizeLocale(locale)
      }
    });
  }

  private async assertParent(menuId: string, parentId?: string | null, currentItemId?: string) {
    if (!parentId) return;

    const parent = await this.prisma.menuItem.findFirst({
      where: { id: parentId, menuId },
      select: { id: true }
    });
    if (!parent) {
      throw new AppError(422, "invalid_menu_parent", "Parent menu item must belong to the same menu.");
    }
    if (!currentItemId) return;

    const menuItems = await this.prisma.menuItem.findMany({
      where: { menuId },
      select: { id: true, parentId: true }
    });
    const menuItemsById = new Map(menuItems.map((item) => [item.id, item]));
    let ancestorId: string | null = parentId;
    const visited = new Set<string>();
    while (ancestorId) {
      if (ancestorId === currentItemId) {
        throw new AppError(422, "invalid_menu_parent", "Menu item cannot use one of its descendants as parent.");
      }
      if (visited.has(ancestorId)) return;
      visited.add(ancestorId);
      ancestorId = menuItemsById.get(ancestorId)?.parentId ?? null;
    }
  }
}
