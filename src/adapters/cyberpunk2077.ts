import type { GameAdapter } from "@/types/domain";
import { baseName, extension, hasPathPart, pathParts } from "@/adapters/utils";

const rootFolders = ["archive", "bin", "engine", "r6", "red4ext", "mods"];

export const cyberpunk2077Adapter: GameAdapter = {
  presetId: "cyberpunk2077",
  name: "Cyberpunk 2077",
  modTypes: [
    {
      id: "cet",
      name: "CET",
      install: {
        kind: "general",
        installPath: "",
        keepPath: true
      }
    },
    {
      id: "archive",
      name: "archive",
      install: {
        kind: "general",
        installPath: "archive/pc/mod"
      }
    },
    {
      id: "script",
      name: "脚本",
      install: {
        kind: "file",
        installPath: "bin/x64/plugins/cyber_engine_tweaks/mods",
        fileName: "lua",
        isExtname: true
      }
    },
    {
      id: "root",
      name: "主目录",
      install: {
        kind: "folder",
        installPath: "",
        folderName: rootFolders,
        include: true
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该赛博朋克 Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (files.some((file) => baseName(file) === "cyber_engine_tweaks.asi")) return "cet";
    if (files.some((file) => extension(file) === "archive")) return "archive";
    if (files.some((file) => extension(file) === "lua")) return "script";
    if (files.some((file) => pathParts(file).some((part) => rootFolders.includes(part)))) {
      return "root";
    }
    if (rootFolders.some((folder) => hasPathPart(files, folder))) return "root";
    return "unknown";
  }
};
