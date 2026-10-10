import type { GameAdapter, GamePreset, ModTypeRule } from "@/types/domain";

export function pathParts(filePath: string) {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function baseName(filePath: string) {
  return pathParts(filePath).pop() ?? filePath;
}

export function extension(filePath: string) {
  const name = baseName(filePath).toLowerCase();
  const index = name.lastIndexOf(".");
  return index === -1 ? "" : name.slice(index + 1);
}

export function hasFile(files: string[], fileName: string) {
  return files.some((file) => baseName(file).toLowerCase() === fileName.toLowerCase());
}

export function hasExtension(files: string[], ext: string) {
  const normalized = ext.replace(/^\./, "").toLowerCase();
  return files.some((file) => extension(file) === normalized);
}

export function hasPathPart(files: string[], part: string) {
  return files.some((file) =>
    pathParts(file).some((item) => item.toLowerCase() === part.toLowerCase())
  );
}

export function manualRule(id = "manual", name = "未知"): ModTypeRule {
  return {
    id,
    name,
    install: {
      kind: "manual",
      reason: "该类型暂未实现自动安装，请手动处理。"
    }
  };
}

export function createCatalogAdapter(preset: GamePreset): GameAdapter {
  const typeNames = preset.typeNames.length > 0 ? preset.typeNames : ["通用类型"];
  const modTypes = typeNames.map<ModTypeRule>((name, index) => {
    const lowerName = name.toLowerCase();
    const id = String(index + 1);

    if (lowerName.includes("未知") || lowerName === "unknown") {
      return manualRule(id, name);
    }

    if (lowerName.includes("pak")) {
      return {
        id,
        name,
        install: { kind: "general", installPath: "Content/Paks/~mods" }
      };
    }

    if (lowerName.includes("bepinex")) {
      return {
        id,
        name,
        install: { kind: "fileSibling", installPath: "", fileName: "winhttp.dll" }
      };
    }

    if (lowerName.includes("reframework")) {
      return {
        id,
        name,
        install: { kind: "fileSibling", installPath: "", fileName: "dinput8.dll" }
      };
    }

    if (lowerName === "autorun") {
      return {
        id,
        name,
        install: { kind: "fileSibling", installPath: "reframework/autorun", fileName: "lua", isExtname: true }
      };
    }

    if (lowerName.includes("plugin") || lowerName.includes("plugins")) {
      return {
        id,
        name,
        install: {
          kind: "folder",
          installPath: lowerName.includes("reframework") ? "reframework/plugins" : "BepInEx/plugins",
          folderName: "plugins",
          spare: true
        }
      };
    }

    if (lowerName === "data") {
      return {
        id,
        name,
        install: { kind: "folder", installPath: "Data", folderName: ["Data", "data"], spare: true }
      };
    }

    if (lowerName === "ui") {
      return {
        id,
        name,
        install: { kind: "folder", installPath: "data/UI", folderName: ["UI", "ui"], spare: true }
      };
    }

    if (lowerName === "extensions") {
      return {
        id,
        name,
        install: { kind: "folderRoot", installPath: "extensions" }
      };
    }

    if (lowerName === "dropzone") {
      return {
        id,
        name,
        install: { kind: "folderRoot", installPath: "dropzone" }
      };
    }

    if (lowerName === "dlc") {
      return {
        id,
        name,
        install: { kind: "folderRoot", installPath: "dlc" }
      };
    }

    if (lowerName === "nativemods") {
      return {
        id,
        name,
        install: { kind: "folderRoot", installPath: "bin/NativeMods" }
      };
    }

    if (lowerName === "northstar") {
      return {
        id,
        name,
        install: { kind: "folderRoot", installPath: "R2Northstar/mods" }
      };
    }

    if (lowerName === "redelbe") {
      return {
        id,
        name,
        install: { kind: "folderRoot", installPath: "REDELBE/Layer2" }
      };
    }

    if (["scs", "esp", "esm", "psarc", "dat", "fdata", "pack", "tmod"].includes(lowerName)) {
      return {
        id,
        name,
        install: { kind: "fileSibling", installPath: "", fileName: lowerName, isExtname: true }
      };
    }

    if (lowerName.includes("mods")) {
      return {
        id,
        name,
        install: { kind: "folder", installPath: "mods", folderName: "mods", spare: true }
      };
    }

    if (lowerName.includes("根目录") || lowerName.includes("通用")) {
      return {
        id,
        name,
        install: { kind: "general", installPath: "", keepPath: true }
      };
    }

    return {
      id,
      name,
      install: { kind: "general", installPath: "", keepPath: true }
    };
  });

  return {
    presetId: preset.id,
    name: preset.name,
    modTypes: modTypes.length > 0 ? modTypes : [manualRule()],
    checkModType(files) {
      const pakRule = modTypes.find((rule) => rule.name.toLowerCase().includes("pak"));
      const bepinexRule = modTypes.find((rule) => rule.name.toLowerCase().includes("bepinex"));
      const reframeworkRule = modTypes.find((rule) => rule.name.toLowerCase().includes("reframework"));
      const dataRule = modTypes.find((rule) => rule.name.toLowerCase() === "data");
      const pluginRule = modTypes.find((rule) => rule.name.toLowerCase().includes("plugin"));
      const modsRule = modTypes.find((rule) => rule.name.toLowerCase().includes("mods"));
      const extRule = modTypes.find((rule) =>
        ["scs", "esp", "esm", "psarc", "dat", "fdata", "pack", "tmod"].includes(rule.name.toLowerCase()) &&
        hasExtension(files, rule.name.toLowerCase())
      );

      if (pakRule && hasExtension(files, "pak")) return pakRule.id;
      if (bepinexRule && hasFile(files, "winhttp.dll")) return bepinexRule.id;
      if (reframeworkRule && hasFile(files, "dinput8.dll")) return reframeworkRule.id;
      if (dataRule && (hasPathPart(files, "Data") || hasPathPart(files, "data") || hasExtension(files, "esp") || hasExtension(files, "esm"))) {
        return dataRule.id;
      }
      if (extRule) return extRule.id;
      if (pluginRule && (hasExtension(files, "dll") || hasPathPart(files, "plugins"))) {
        return pluginRule.id;
      }
      if (modsRule && hasPathPart(files, "mods")) return modsRule.id;

      return modTypes[0]?.id ?? "manual";
    }
  };
}
