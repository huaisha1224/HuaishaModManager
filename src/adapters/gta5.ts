import type { GameAdapter, ModTypeRule } from "@/types/domain";
import { hasExtension, hasFile, hasPathPart } from "@/adapters/utils";

export function createGta5Adapter(presetId: string, name: string): GameAdapter {
  const modTypes: ModTypeRule[] = [
    {
      id: "asi",
      name: "asi",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "asi",
        isExtname: true
      }
    },
    {
      id: "gameconfig",
      name: "gameconfig",
      install: {
        kind: "manual",
        reason: "gameconfig.xml 需要写入 update.rpf 内部路径 common/data/gameconfig.xml，请使用 OpenIV 或后续 RPF 工具链处理。"
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
      id: "scripthookv",
      name: "ScriptHookV",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "ScriptHookV.dll"
      }
    },
    {
      id: "script",
      name: "script",
      install: {
        kind: "general",
        installPath: "scripts",
        keepPath: true
      }
    },
    {
      id: "dlc",
      name: "dlc",
      install: {
        kind: "fileIntoParentFolder",
        installPath: "mods/update/x64/dlcpacks",
        fileName: "dlc.rpf",
        requireParent: true
      }
    },
    {
      id: "vehicle-files",
      name: "tyf",
      install: {
        kind: "manual",
        reason: "yft/ytd 车辆文件需要打包进 GTA5 的 RPF 容器，请使用 OpenIV 或后续 RPF 工具链处理。"
      }
    },
    {
      id: "ped-files",
      name: "ydd",
      install: {
        kind: "manual",
        reason: "ydd/ytd 人物文件需要写入 GTA5 的 RPF 容器并维护 pedmodelinfo.meta，请使用 OpenIV 或后续 RPF 工具链处理。"
      }
    },
    {
      id: "tools",
      name: "tools",
      install: {
        kind: "manual",
        reason: "RPF 工具属于管理器前置工具，当前 Electron 版还未接入工具链安装。"
      }
    },
    {
      id: "oiv",
      name: "oiv",
      install: {
        kind: "manual",
        reason: "oiv 包请使用 OpenIV 安装，当前本地安装器不直接执行 oiv 脚本。"
      }
    },
    {
      id: "unknown",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该 GTA5 Mod 类型未知，请手动安装。"
      }
    }
  ];

  return {
    presetId,
    name,
    modTypes,
    checkModType(files) {
      if (hasFile(files, "ScriptHookV.dll")) return "scripthookv";
      if (hasFile(files, "rpf.dll")) return "tools";
      if (hasExtension(files, "asi")) return "asi";
      if (hasFile(files, "gameconfig.xml")) return "gameconfig";
      if (hasPathPart(files, "scripts") || hasExtension(files, "cs") || hasExtension(files, "dll")) return "script";
      if (hasFile(files, "dlc.rpf")) return "dlc";
      if (hasExtension(files, "ydd")) return "ped-files";
      if (hasExtension(files, "yft") || hasExtension(files, "ytd")) return "vehicle-files";
      if (hasExtension(files, "oiv")) return "oiv";
      return "root";
    }
  };
}
