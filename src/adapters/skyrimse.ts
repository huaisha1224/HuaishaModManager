import type { GameAdapter } from "@/types/domain";
import { hasExtension, hasFile, hasPathPart } from "@/adapters/utils";

export const skyrimSeAdapter: GameAdapter = {
  presetId: "skyrimse",
  name: "Skyrim Special Edition",
  modTypes: [
    {
      id: "data",
      name: "Data",
      install: {
        kind: "bethesdaData",
        installPath: "Data",
        folderName: "Data",
        documentsGameFolder: "Skyrim Special Edition",
        iniFileName: "Skyrim.ini",
        localAppDataGameFolder: "Skyrim Special Edition"
      }
    },
    {
      id: "skse64",
      name: "skse64",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "skse64_loader.exe"
      }
    },
    {
      id: "plugins",
      name: "Plugins",
      install: {
        kind: "folder",
        installPath: "Data/SKSE/Plugins",
        folderName: "Plugins",
        spare: true
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 Skyrim SE Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "skse64_loader.exe")) return "skse64";
    if (hasPathPart(files, "SKSE") || hasPathPart(files, "Plugins") || hasExtension(files, "dll")) {
      return "plugins";
    }
    if (
      hasPathPart(files, "Data") ||
      hasExtension(files, "esp") ||
      hasExtension(files, "esm") ||
      hasExtension(files, "esl") ||
      hasExtension(files, "bsa")
    ) {
      return "data";
    }

    return "unknown";
  }
};
