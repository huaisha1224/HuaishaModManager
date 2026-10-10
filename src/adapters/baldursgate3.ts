import type { GameAdapter } from "@/types/domain";
import { hasExtension, hasPathPart } from "@/adapters/utils";

export const baldursGate3Adapter: GameAdapter = {
  presetId: "baldursgate3",
  name: "Baldur's Gate 3",
  modTypes: [
    {
      id: "pak",
      name: "pak",
      install: {
        kind: "bg3Pak",
        installPath: "Local/Larian Studios/Baldur's Gate 3/Mods",
        targetScope: "appData",
        managedToolFileName: "BaldursGate3.dll"
      }
    },
    {
      id: "data",
      name: "Data",
      install: {
        kind: "folder",
        installPath: "Data",
        folderName: "Data",
        spare: true
      }
    },
    {
      id: "plugins",
      name: "插件",
      install: {
        kind: "folder",
        installPath: "bin",
        folderName: "bin",
        spare: true
      }
    },
    {
      id: "nativeMods",
      name: "NativeMods",
      install: {
        kind: "folder",
        installPath: "bin/NativeMods",
        folderName: "NativeMods",
        spare: true
      }
    },
    {
      id: "bin",
      name: "bin",
      install: {
        kind: "folder",
        installPath: "bin",
        folderName: "bin",
        spare: true
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 Baldur's Gate 3 Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasExtension(files, "pak")) return "pak";
    if (hasExtension(files, "dll") && files.some((file) => file.toLowerCase().endsWith("baldursgate3.dll"))) {
      return "plugins";
    }
    if (hasPathPart(files, "NativeMods")) return "nativeMods";
    if (hasPathPart(files, "bin")) return "bin";
    if (hasPathPart(files, "Data")) return "data";
    if (hasExtension(files, "dll")) return "plugins";
    return "unknown";
  }
};
