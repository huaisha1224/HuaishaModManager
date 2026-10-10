import type { GameAdapter } from "@/types/domain";
import { hasFile, hasPathPart } from "@/adapters/utils";

export const stardewValleyAdapter: GameAdapter = {
  presetId: "stardewvalley",
  name: "Stardew Valley",
  modTypes: [
    {
      id: "smapi",
      name: "SMAPI",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "StardewModdingAPI.exe"
      }
    },
    {
      id: "mods",
      name: "普通 Mod",
      install: {
        kind: "folderRoot",
        installPath: "Mods"
      }
    },
    {
      id: "mods-folder",
      name: "Mods 目录",
      install: {
        kind: "folder",
        installPath: "Mods",
        folderName: "Mods",
        spare: false
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 Stardew Valley Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "StardewModdingAPI.exe") || hasFile(files, "SMAPI.Installer.dll")) return "smapi";
    if (hasPathPart(files, "Mods")) return "mods-folder";
    if (hasFile(files, "manifest.json")) return "mods";
    return "unknown";
  }
};
