import type { GameAdapter } from "@/types/domain";
import { hasFile } from "@/adapters/utils";
import { createUnrealAdapter } from "@/adapters/unreal";

const unrealAdapter = createUnrealAdapter("inzoi", "inZOI", "BlueClient");

export const inzoiAdapter: GameAdapter = {
  presetId: "inzoi",
  name: "inZOI",
  modTypes: [
    ...unrealAdapter.modTypes,
    {
      id: "modkit",
      name: "MODkit",
      install: {
        kind: "inzoiModKit",
        installPath: "inZOI/Mods",
        targetScope: "documents"
      }
    }
  ],
  checkModType(files) {
    if (hasFile(files, "mod_manifest.json")) return "modkit";
    return unrealAdapter.checkModType(files);
  }
};
