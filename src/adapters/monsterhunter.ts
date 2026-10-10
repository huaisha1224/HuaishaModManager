import type { GameAdapter, ModTypeRule } from "@/types/domain";
import { hasExtension, hasFile, hasPathPart } from "@/adapters/utils";

export const monsterHunterWorldAdapter: GameAdapter = {
  presetId: "monsterhunterworld",
  name: "Monster Hunter World",
  modTypes: [
    {
      id: "stracker",
      name: "Stracker",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "dtdata.dll"
      }
    },
    {
      id: "nativePc",
      name: "通用类型",
      install: {
        kind: "folder",
        installPath: "nativePC",
        folderName: "nativePC",
        spare: true
      }
    },
    {
      id: "plugins",
      name: "插件",
      install: {
        kind: "fileSibling",
        installPath: "nativePC/plugins",
        fileName: ".dll",
        isExtname: true
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 Monster Hunter World Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "dtdata.dll") || hasFile(files, "loader.dll")) return "stracker";
    if (hasPathPart(files, "plugins")) return "plugins";
    if (hasExtension(files, "dll")) return "plugins";
    if (hasPathPart(files, "nativePC")) return "nativePc";
    return "nativePc";
  }
};

export function createReEngineAdapter(presetId: string, name: string): GameAdapter {
  const modTypes: ModTypeRule[] = [
    {
      id: "natives",
      name: "通用类型",
      install: {
        kind: "folder",
        installPath: "natives",
        folderName: "natives",
        spare: true
      }
    },
    {
      id: "reframework",
      name: "REFramework",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "dinput8.dll"
      }
    },
    {
      id: "plugins",
      name: "插件",
      install: {
        kind: "folder",
        installPath: "reframework/plugins",
        folderName: "plugins",
        spare: true
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
      if (hasFile(files, "dinput8.dll")) return "reframework";
      if (hasPathPart(files, "reframework") || hasPathPart(files, "plugins")) return "plugins";
      if (hasPathPart(files, "natives")) return "natives";
      return "natives";
    }
  };
}
