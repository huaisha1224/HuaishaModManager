export interface ManagedGame {
  id: string;
  presetId: string;
  catalogGameId: number;
  steamAppId: number;
  nexusDomain: string;
  nexusGameId: number;
  name: string;
  zhName?: string;
  path: string;
  installPath: string;
  launchArgs: string;
  exeNames: string[];
  coverUrl: string;
  typeNames: string[];
  customAdapterRules: CustomAdapterRule[];
  adapterStatus: "catalogued" | "implemented" | "custom";
  // BUG-010(2026-10-03):game 根目录相对 game.path 的偏移(相对路径,如 "..\\..\\")。
  //   适用:exe 在游戏根的子目录(如巫师 3 witcher3.exe 在 bin/x64_dx12/)时,
  //   需要上溯 N 级才能拿到真正的游戏根。
  //   后端 IPC 在 gamePath 上 path.resolve(gamePath, gameBasePath) 后作为 effectiveGamePath,
  //   这样 installPath="mods" 才能解析到 <real game root>/mods/ 而不是 <exe dir>/mods/。
  gameBasePath?: string;
  // BUG-015(2026-10-04):per-game scan modTypeId 白名单(只扫这些 modTypeId 对应的 installPath)。
  //   适用:游戏有多个 modType(mods + dlc),但用户只希望 scan 在 mods 目录下发现手动 mod,
  //   dlc/bin 等子目录留给 installOneFeatured 主动创建 LocalMod,不通过 scan 自动入库。
  //   留空(undefined / 空数组) = 行为不变(扫所有 SCAN_KINDS 命中 modType)。
  scanModTypeIds?: string[];
  createdAt: number;
}

export type InstallTargetScope = "game" | "documents" | "appData";

export type InstallStrategy =
  | {
      kind: "general";
      installPath: string;
      keepPath?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "folder";
      installPath: string;
      folderName: string | string[];
      include?: boolean;
      spare?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "folderRoot";
      installPath: string;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "file";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      commonParent?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileSibling";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      pass?: string[];
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileOnly";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "folderParent";
      installPath: string;
      folderName: string | string[];
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileMap";
      installPath: string;
      dictionaryFile: string;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "fileIntoParentFolder";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
      requireParent?: boolean;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "bethesdaData";
      installPath: string;
      folderName: string | string[];
      documentsGameFolder: string;
      iniFileName: string;
      localAppDataGameFolder: string;
      pluginsHeader?: string;
      updateGeneralTestFiles?: boolean;
    }
  | {
      kind: "bethesdaPluginFiles";
      installPath: string;
      documentsGameFolder: string;
      iniFileName: string;
      localAppDataGameFolder: string;
      pluginsHeader?: string;
      updateGeneralTestFiles?: boolean;
    }
  | {
      kind: "oblivionPlugins";
      installPath: string;
    }
  | {
      kind: "noMansSkyMods";
      installPath: string;
      keepPath?: boolean;
    }
  | {
      kind: "numberedPak";
      installPath: string;
      extension: string;
      prefix: string;
      startIndex: number;
      listFileName: string;
    }
  | {
      kind: "watchDogsPatch";
      installPath: string;
      listFileName: string;
    }
  | {
      kind: "michangshengLinkedFolder";
      installPath: string;
      rootFile: string;
    }
  | {
      kind: "michangshengDllPlugins";
      installPath: string;
    }
  | {
      kind: "legendPortraits";
      installPath: string;
      portraitFolders: string[];
    }
  | {
      kind: "inzoiModKit";
      installPath: string;
      targetScope?: InstallTargetScope;
    }
  | {
      kind: "bg3Pak";
      installPath: string;
      targetScope: "appData";
      managedToolFileName: string;
    }
  | {
      kind: "redDeadAsi";
      installPath: string;
      fileName: string;
      isExtname?: boolean;
    }
  | {
      kind: "redDeadLml";
      installPath: string;
    }
  | {
      kind: "manual";
      reason: string;
    };

export interface ModTypeRule {
  id: string;
  name: string;
  install: InstallStrategy;
  uninstall?: InstallStrategy;
  requiredModNames?: string[];
}

export interface CustomAdapterRule {
  id: string;
  name: string;
  detect: {
    kind: "always" | "fileName" | "extension" | "pathPart";
    value: string;
  };
  install: InstallStrategy;
}

export interface GameAdapter {
  presetId: string;
  name: string;
  modTypes: ModTypeRule[];
  checkModType: (files: string[]) => string;
  // BUG-010(2026-10-03):game-specific 扫描扩展名白名单
  //   undefined → 后端用默认 SCAN_MOD_FILE_EXTENSIONS(.pak/.dll/.lua/.uasset/.uexp)
  //   例:巫师 3 → ["bundle","ws","lua","xml",...] 覆盖默认,因为 ScriptStudio mod
  //       用 .bundle(REDengine)+ .ws(WitcherScript),默认不识别
  scanExtensions?: string[];
}

export interface GamePreset {
  id: string;
  name: string;
  zhName?: string;
  sourceFile: string;
  catalogGameId: number;
  steamAppId: number;
  nexusDomain: string;
  nexusGameId: number;
  exeNames: string[];
  coverUrl: string;
  typeNames: string[];
  /** 默认启动参数(空格分隔)。新加游戏时若用户未指定,会用此值。
   *  例:blackwukong 默认 -fileopenlog(UE4SS mod 必需)。*/
  launchArgs?: string;
  adapterStatus: "catalogued" | "implemented";
  // BUG-010(2026-10-03):game 根目录相对 game.path 的偏移(相对路径,如 "..\\..\\")。
  //   适用:exe 在游戏根的子目录(如巫师 3 witcher3.exe 在 bin/x64_dx12/)时,
  //   需要上溯 N 级才能拿到真正的游戏根。ManagedGame 构造时拷贝。
  gameBasePath?: string;
  // BUG-015(2026-10-04):per-game scan modTypeId 白名单。ManagedGame 构造时拷贝。
  //   老游戏 runtime fallback:用户游戏入库早于字段加入时 ManagedGame.scanModTypeIds 为 undefined,
  //   resolveGameScanModTypeIds(game) 会回退到 preset.scanModTypeIds。
  scanModTypeIds?: string[];
}

export interface LocalMod {
  id: string;
  gameId: string;
  sortIndex: number;
  name: string;
  sourcePath: string;
  rootPath: string;
  version: string;
  author: string;
  website: string;
  description: string;
  coverImage: string;
  tags: string[];
  requirements: string[];
  files: string[];
  modTypeId: string;
  modTypeName: string;
  installed: boolean;
  /** 绝对路径模态专用:实际生效路径(如 C:\\Palworld\\flyy_Palworld)。 */
  installedPath?: string;
  deployedFiles: string[];
  updateSource?: ModUpdateSource;
  createdAt: number;
  updatedAt: number;
}

export interface ModProfile {
  id: string;
  gameId: string;
  name: string;
  enabledModIds: string[];
  modOrder: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ModUpdateCheck {
  status: "unknown" | "latest" | "available" | "unsupported" | "failed";
  checkedAt: number;
  message: string;
  latestFileId: string;
  latestFileName: string;
  latestVersion: string;
  latestUploadedAt: string;
  detailsUrl: string;
}

export interface ModUpdateSource {
  type: "nexus" | "featured";
  gameDomain: string;
  gameName: string;
  modId: string;
  fileId: string;
  fileName: string;
  fileVersion: string;
  modVersion: string;
  categoryName: string;
  modPageUrl: string;
  filePageUrl: string;
  coverImage?: string;
  downloadedAt: number;
  check?: ModUpdateCheck;
  /** BUG-009:精选 mod 的 JSON InstallLocation(完整相对路径)。
   *  installMod 入口用它覆盖 adapter.modType.install.installPath,
   *  让精选 mod 完全按 JSON 配置安装,不受 adapter 路径不对齐影响。
   *  仅 type="featured" 时有效。 */
  featuredInstallPath?: string;
  // BUG-016 round 3(2026-10-04):parentModId 字段已废弃。
  //   round 1+2 试图用此字段把 subFile 折叠到主 mod,用户实测无效 → 推翻。
  //   round 3 改为 subFile 不创建 LocalMod 记录,根本不需要此字段。
  //   字段保留(可选)不删,因为老数据可能写入过,类型兼容需要它存在。
  parentModId?: string;
}

export interface InstallPlan {
  targetFiles: string[];
  conflicts: string[];
}

// HGMM Phase 5:mod 来源标签 — 用于按来源筛选已安装 mod
export const MOD_ORIGIN_TAGS = {
  featured: "精选",
  nexus: "Nexus",
  steamWorkshop: "创意工坊",
  imported: "导入",
  custom: "自定义"  // 用户手动丢到游戏目录的(由扫描游戏目录功能自动发现)
} as const;

export type ModOriginTag = typeof MOD_ORIGIN_TAGS[keyof typeof MOD_ORIGIN_TAGS];

/** mod 推断来源(用于数据迁移和老数据回填) */
export type ModOriginKind = keyof typeof MOD_ORIGIN_TAGS;

export interface CustomAdapterTestResult {
  sourcePath: string;
  files: string[];
  modTypeId: string;
  modTypeName: string;
  strategyKind: InstallStrategy["kind"];
  plan: InstallPlan;
  manualReason: string;
}

export interface NexusUser {
  key: string;
  name: string;
  email: string;
  profileUrl: string;
  avatar?: string;
  isPremium: boolean;
  isSupporter: boolean;
}

export interface NexusModFile {
  id: string;
  name: string;
  version: string;
  size: number;
  createdAt: string;
  categoryName: string;
  downloadUrl: string;
  detailsUrl: string;
}

export interface NexusModItem {
  id: string;
  title: string;
  summary: string;
  author: string;
  version: string;
  website: string;
  cover: string;
  downloads: number;
  likes: number;
  categories: string[];
  createdAt: string;
  updatedAt: string;
  nsfw: boolean;
  filesCount: number;
  primaryFile: NexusModFile | null;
}

export interface NexusModImage {
  id: string;
  title: string;
  thumbnailUrl: string;
  imageUrl: string;
}

export interface NexusModDetail extends NexusModItem {
  description: string;
  descriptionFormat: "html" | "text";
  images: NexusModImage[];
  files: NexusModFile[];
}

export interface NexusModListResult {
  items: NexusModItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  facets: {
    categoryName: Array<{ label: string; value: string; count: number }>;
    languageName: Array<{ label: string; value: string; count: number }>;
    tag: Array<{ label: string; value: string; count: number }>;
  };
}

export interface DownloadTask {
  id: string;
  gameId: string;
  gameName: string;
  source: "NexusMods" | "Custom";
  modId: string;
  modName: string;
  fileId: string;
  fileName: string;
  url: string;
  outputPath: string;
  coverImage?: string;
  updateSource?: ModUpdateSource;
  updateTargetModId?: string;
  status: "queued" | "downloading" | "paused" | "completed" | "failed" | "external";
  receivedBytes: number;
  totalBytes: number;
  speed?: number;
  error: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppLogEntry {
  /** BUG-009:加 "warn" 级别,用于"未复制任何文件"等非阻塞异常 */
  level: "info" | "warn" | "error";
  id: string;
  source: string;
  message: string;
  detail: string;
  createdAt: number;
}

export interface BackupEntry {
  id: string;
  gameId: string;
  gameName: string;
  name: string;
  sourcePath: string;
  outputPath: string;
  size: number;
  filesCount: number;
  createdAt: number;
}

export interface DataBackupEntry {
  id: string;
  name: string;
  outputPath: string;
  size: number;
  createdAt: number;
}

export interface AppSettings {
  storagePath: string;
  tagColors: Record<string, string>;
  useSymlinkInstall: boolean;
  nexusApiKey: string;
  nexusAccessToken: string;
  nexusRefreshToken: string;
  nexusTokenExpiresAt: number;
  nexusUser: NexusUser | null;
  translationProvider: "off" | "google-gtx" | "baidu" | "youdao" | "tencent" | "volcengine" | "ollama";
  translationTargetLang: "zh-CN";
  baiduTranslateAppId: string;
  baiduTranslateSecret: string;
  youdaoTranslateAppKey: string;
  youdaoTranslateSecret: string;
  tencentTranslateSecretId: string;
  tencentTranslateSecretKey: string;
  tencentTranslateRegion: string;
  volcengineTranslateAccessKeyId: string;
  volcengineTranslateSecretAccessKey: string;
  volcengineTranslateRegion: string;
  ollamaTranslateBaseUrl: string;
  ollamaTranslateModel: string;
  ollamaTranslateTimeoutMs: number;
  theme: "dark" | "light";
  language: "zh-CN" | "en-US";
  defaultTab: "games" | "manager" | "nexus" | "download" | "logs" | "backup" | "settings" | "about";
  autoImportAfterDownload: boolean;
  downloadEngine: "builtin" | "aria2";
  aria2ExecutablePath: string;
  aria2MaxConnections: number;
  proxyEnabled: boolean;
  proxyUrl: string;
  preferDirectoryGamePicker: boolean;
  launchAtStartup: boolean;
  allowGameRunningChanges: boolean;
  debugMode: boolean;
  showDebugInfo: boolean;
  autoCheckUpdates: boolean;
  appUpdateUrl: string;
  lastAppUpdateCheckAt: number;
  lastAutoUpdateCheckAt: number;
}

export interface AppUpdateInfo {
  versionName: string;
  downloadUrl: string;
  updateLog: string;
  forceUpdate: boolean;
}

export interface AppUpdateCheckResult {
  hasUpdate: boolean;
  versionCompare: number;
  currentVersionName: string;
  remote: AppUpdateInfo;
}

export interface AppData {
  dataVersion: number;
  settings: AppSettings;
  games: ManagedGame[];
  activeGameId: string;
  modProfiles: ModProfile[];
  mods: LocalMod[];
  downloads: DownloadTask[];
  logs: AppLogEntry[];
  backups: BackupEntry[];
  dataBackups: DataBackupEntry[];
  translationCache: Record<string, {
    text: string;
    createdAt: number;
  }>;
  // FEATURE-020(2026-10-08):精选 mod 缓存复用,key=FeaturedMod.id,value=JSON updatedAt
  //  老数据 runtime fallback:字段缺失时降级"每次都下"(baseline,不出错)
  //  跟 translationCache 一样是字典;模版不强制,缺失等同于 {}
  featuredCache?: Record<string, string>;
}
