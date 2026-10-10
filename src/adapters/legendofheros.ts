import type { GameAdapter } from "@/types/domain";
import { baseName, extension, hasFile, hasPathPart, pathParts } from "@/adapters/utils";

const THREE_KINGDOM_DICTIONARY = "resources/ThreeKingdomDictionary.txt";
const PORTRAIT_FOLDERS = ["260x340", "1000x1400", "1024x1024"];

function hasPortraitFolder(files: string[]) {
  const portraitFolders = new Set(PORTRAIT_FOLDERS.map((folder) => folder.toLowerCase()));

  return files.some((file) =>
    pathParts(file).some((part) => portraitFolders.has(part.toLowerCase()))
  );
}

function looksLikeThreeKingdomDataFile(filePath: string) {
  const name = baseName(filePath).toLowerCase();

  if (hasPathPart([filePath], "ThreeKingdom_Data")) return true;
  if (name === "app.info" || name === "boot.config") return true;
  if (name === "globalgamemanagers" || name === "globalgamemanagers.assets") return true;
  if (name === "resources.assets" || name === "resources.resource") return true;
  if (/^level\d+(\.ress)?$/iu.test(name)) return true;
  if (/^sharedassets\d+\.assets(\.resource)?$/iu.test(name)) return true;

  return false;
}

export const legendOfHerosAdapter: GameAdapter = {
  presetId: "legendofheros",
  name: "Legend of Heroes Three Kingdoms",
  modTypes: [
    {
      id: "1",
      name: "MelonLoader",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "version.dll"
      }
    },
    {
      id: "2",
      name: "mods",
      install: {
        kind: "fileSibling",
        installPath: "mods",
        fileName: "dll",
        isExtname: true
      }
    },
    {
      id: "3",
      name: "游戏根目录",
      install: {
        kind: "general",
        installPath: "",
        keepPath: false
      }
    },
    {
      id: "4",
      name: "Data",
      install: {
        kind: "fileMap",
        installPath: "",
        dictionaryFile: THREE_KINGDOM_DICTIONARY
      }
    },
    {
      id: "5",
      name: "Portraits",
      install: {
        kind: "legendPortraits",
        installPath: "ThreeKingdom_Data/StreamingAssets/Portraits",
        portraitFolders: PORTRAIT_FOLDERS
      }
    },
    {
      id: "99",
      name: "未知",
      install: {
        kind: "manual",
        reason: "该英雄立志传：三国志 Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (files.some(looksLikeThreeKingdomDataFile)) return "4";
    if (hasPortraitFolder(files)) return "5";
    if (hasFile(files, "version.dll")) return "1";
    if (files.some((file) => extension(file) === "dll")) return "2";

    return "99";
  }
};
