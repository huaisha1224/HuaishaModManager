import type { GameAdapter } from "@/types/domain";
import { baseName, hasFile } from "@/adapters/utils";

const ELDEN_RING_DICTIONARY = "resources/EldenRingDictionary.txt";
const knownExtensions = new Set([
  "anibnd",
  "bdt",
  "bhd",
  "dcx",
  "emevd",
  "ffx",
  "hks",
  "msgbnd",
  "parambnd",
  "regulation",
  "tae",
  "tpf",
  "xml"
]);

function fileStem(filePath: string) {
  const name = baseName(filePath).toLowerCase();
  const index = name.indexOf(".");
  return index === -1 ? name : name.slice(0, index);
}

function looksLikeGameFile(filePath: string) {
  const name = baseName(filePath).toLowerCase();
  const parts = name.split(".").filter(Boolean);

  if (name === "regulation.bin") return true;
  if (parts.some((part) => knownExtensions.has(part))) return true;

  return /^(c|aeg|s|m|wp|bd|am|sd|gr)\d+/u.test(fileStem(filePath));
}

export const eldenRingAdapter: GameAdapter = {
  presetId: "eldenring",
  name: "ELDEN RING",
  modTypes: [
    {
      id: "modengine2",
      name: "Engine 2",
      install: {
        kind: "fileSibling",
        installPath: "",
        fileName: "modengine2_launcher.exe"
      }
    },
    {
      id: "modengine2-mods",
      name: "通用类型",
      install: {
        kind: "fileMap",
        installPath: "mods",
        dictionaryFile: ELDEN_RING_DICTIONARY
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
        reason: "该 Elden Ring Mod 类型未知，请手动安装。"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "modengine2_launcher.exe")) return "modengine2";
    if (files.some(looksLikeGameFile)) return "modengine2-mods";
    return "unknown";
  }
};
