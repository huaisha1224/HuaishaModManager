import type { GameAdapter, ModTypeRule } from "@/types/domain";
import { hasExtension, hasFile, hasPathPart } from "@/adapters/utils";

export function createUnrealAdapter(presetId: string, name: string, basePath = ""): GameAdapter {
  const withBase = (path: string) => [basePath, path].filter(Boolean).join("/");
  const modTypes: ModTypeRule[] = [
    {
      id: "pak",
      name: "pak",
      install: {
        kind: "general",
        installPath: withBase("Content/Paks/~mods")
      }
    },
    {
      id: "ue4ss",
      name: "UE4SS",
      install: {
        kind: "fileSibling",
        installPath: withBase("Binaries/Win64"),
        fileName: "dwmapi.dll"
      }
    },
    {
      id: "ue4ss-xinput",
      name: "UE4SS xinput",
      install: {
        kind: "fileSibling",
        installPath: withBase("Binaries/Win64"),
        fileName: "xinput1_3.dll"
      }
    },
    {
      id: "mods",
      name: "mods",
      install: {
        kind: "folderParent",
        installPath: withBase("Binaries/Win64/ue4ss/Mods"),
        folderName: "Enabled.txt"
      }
    },
    {
      id: "logicMods",
      name: "LogicMods",
      install: {
        kind: "general",
        installPath: withBase("Content/Paks/LogicMods")
      }
    },
    {
      id: "scripts",
      name: "Scripts",
      install: {
        kind: "folderParent",
        installPath: withBase("Binaries/Win64/ue4ss/Mods"),
        folderName: "Scripts"
      }
    },
    {
      id: "root",
      name: "游戏根目录",
      install: {
        kind: "general",
        installPath: "",
        keepPath: true
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: `该 ${name} Mod 类型未知，请手动安装。`
      }
    }
  ];

  return {
    presetId,
    name,
    modTypes,
    checkModType(files) {
      if (hasFile(files, "dwmapi.dll")) return "ue4ss";
      if (hasFile(files, "xinput1_3.dll")) return "ue4ss-xinput";
      if (hasExtension(files, "pak") && hasPathPart(files, "LogicMods")) return "logicMods";
      if (hasExtension(files, "pak")) return "pak";
      if (hasFile(files, "Enabled.txt")) return "mods";
      if (hasPathPart(files, "Scripts")) return "scripts";
      return "root";
    }
  };
}
