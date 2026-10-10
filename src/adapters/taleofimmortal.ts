import type { GameAdapter } from "@/types/domain";
import { hasFile } from "@/adapters/utils";

export const taleOfImmortalAdapter: GameAdapter = {
  presetId: "taleofimmortal",
  name: "Tale of Immortal",
  modTypes: [
    {
      id: "modExportData",
      name: "通用",
      install: {
        kind: "file",
        installPath: "ModExportData",
        fileName: "ModExportData.cache"
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该鬼谷八荒 Mod 未找到 ModExportData.cache，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "ModExportData.cache")) return "modExportData";
    return "unknown";
  }
};
