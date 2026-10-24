import type { NavigationPlugin } from "zudoku";
import { localizedNavigation } from "./navigation";

const docsI18nPlugin: NavigationPlugin = {
  getRoutes: () => [],
  getNavigation: async (pathname) => localizedNavigation(pathname),
};

export default docsI18nPlugin;
