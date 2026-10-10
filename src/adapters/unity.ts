import type { GameAdapter } from "@/types/domain";
import { hasExtension, hasFile, hasPathPart } from "@/adapters/utils";

export function createUnityAdapter(presetId: string, name: string): GameAdapter {
  return {
    presetId,
    name,
    modTypes: [
      {
        id: "bepinex",
        name: "BepInEx",
        install: {
          kind: "fileSibling",
          installPath: "",
          fileName: "winhttp.dll"
        }
      },
      {
        id: "plugins",
        name: "plugins",
        install: {
          kind: "folder",
          installPath: "BepInEx/plugins",
          folderName: "plugins",
          spare: true
        }
      },
      {
        id: "root",
        name: "游戏根目录",
        install: {
          kind: "general",
          installPath: "",
          keepPath: false
        }
      }
    ],
    checkModType(files) {
      if (hasFile(files, "winhttp.dll")) return "bepinex";
      if (hasPathPart(files, "plugins") || hasExtension(files, "dll")) return "plugins";
      return "root";
    }
  };
}

export function createMelonLoaderAdapter(presetId: string, name: string): GameAdapter {
  return {
    presetId,
    name,
    modTypes: [
      {
        id: "melonloader",
        name: "MelonLoader",
        install: {
          kind: "fileSibling",
          installPath: "",
          fileName: "version.dll"
        }
      },
      {
        id: "mods",
        name: "mods",
        install: {
          kind: "fileSibling",
          installPath: "mods",
          fileName: "dll",
          isExtname: true
        }
      },
      {
        id: "root",
        name: "游戏根目录",
        install: {
          kind: "general",
          installPath: "",
          keepPath: false
        }
      }
    ],
    checkModType(files) {
      if (hasFile(files, "version.dll")) return "melonloader";
      if (hasExtension(files, "dll")) return "mods";
      return "root";
    }
  };
}
