import type { GameAdapter } from "@/types/domain";
import { hasExtension, hasPathPart } from "@/adapters/utils";
import { createUnrealAdapter } from "@/adapters/unreal";

const unrealAdapter = createUnrealAdapter("oblivionremastered", "Oblivion Remastered", "OblivionRemastered");

export const oblivionRemasteredAdapter: GameAdapter = {
  presetId: "oblivionremastered",
  name: "Oblivion Remastered",
  modTypes: [
    ...unrealAdapter.modTypes.filter((type) => type.id !== "root"),
    {
      id: "root",
      name: "游戏根目录",
      install: {
        kind: "folder",
        installPath: "",
        folderName: "OblivionRemastered",
        include: true,
        spare: true
      }
    },
    {
      id: "data",
      name: "Data",
      install: {
        kind: "folder",
        installPath: "OblivionRemastered/Content/Dev/ObvData/Data",
        folderName: "Data",
        spare: true
      }
    },
    {
      id: "esp",
      name: "esp",
      install: {
        kind: "oblivionPlugins",
        installPath: "OblivionRemastered/Content/Dev/ObvData/Data"
      }
    }
  ],
  checkModType(files) {
    if (hasExtension(files, "esp")) return "esp";
    if (hasPathPart(files, "Data")) return "data";
    if (hasPathPart(files, "OblivionRemastered")) return "root";
    return unrealAdapter.checkModType(files);
  }
};
