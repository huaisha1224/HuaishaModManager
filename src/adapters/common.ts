import type { GameAdapter } from "@/types/domain";

export const commonAdapter: GameAdapter = {
  presetId: "common",
  name: "通用游戏",
  modTypes: [
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
      id: "mods",
      name: "mods",
      install: {
        kind: "folder",
        installPath: "mods",
        folderName: "mods",
        spare: true
      }
    }
  ],
  checkModType(files) {
    return files.some((file) => file.toLowerCase().replace(/\\/g, "/").includes("/mods/"))
      ? "mods"
      : "root";
  }
};
