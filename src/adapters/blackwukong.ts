import type { GameAdapter } from "@/types/domain";
import { createUnrealAdapter } from "@/adapters/unreal";
import { hasPathPart } from "@/adapters/utils";

const unrealAdapter = createUnrealAdapter("blackwukong", "Black Myth Wukong", "b1");

export const blackWukongAdapter: GameAdapter = {
  ...unrealAdapter,
  modTypes: unrealAdapter.modTypes.map((type) =>
    type.id === "root"
      ? {
          ...type,
          name: "游戏根目录"
        }
      : type
  ),
  checkModType(files) {
    if (hasPathPart(files, "b1")) return "root";
    return unrealAdapter.checkModType(files);
  }
};
