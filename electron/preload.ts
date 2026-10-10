import * as electron from "electron";

electron.contextBridge.exposeInMainWorld("mayfly", {
  // 怀沙:showAlert 已废弃,改用 src/services/dialog.ts 的 appAlert 主题弹窗
  openDirectory: (options?: { title?: string }) =>
    electron.ipcRenderer.invoke("dialog:openDirectory", options) as Promise<string>,
  openExecutable: (options?: { title?: string }) =>
    electron.ipcRenderer.invoke("dialog:openExecutable", options) as Promise<string>,
  openImage: () => electron.ipcRenderer.invoke("dialog:openImage") as Promise<string>,
  openArchive: () => electron.ipcRenderer.invoke("dialog:openArchive") as Promise<string[]>,
  openModSource: () => electron.ipcRenderer.invoke("dialog:openModSource") as Promise<string[]>,
  openJson: () => electron.ipcRenderer.invoke("dialog:openJson") as Promise<string>,
  saveJson: (defaultPath: string) =>
    electron.ipcRenderer.invoke("dialog:saveJson", defaultPath) as Promise<string>,
  saveFile: (options: {
    defaultPath: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => electron.ipcRenderer.invoke("dialog:saveFile", options) as Promise<string>,
  getPathForFile: (file: File) => electron.webUtils.getPathForFile(file),
  openPath: (targetPath: string) =>
    electron.ipcRenderer.invoke("shell:openPath", targetPath) as Promise<boolean>,
  openExternal: (targetUrl: string) =>
    electron.ipcRenderer.invoke("shell:openExternal", targetUrl) as Promise<boolean>,
  fileUrl: (targetPath: string) =>
    electron.ipcRenderer.invoke("shell:fileUrl", targetPath) as Promise<string>,
  launchExecutable: (options: {
    executablePath: string;
    cwd?: string;
    args?: string[];
  }) => electron.ipcRenderer.invoke("app:launchExecutable", options) as Promise<boolean>,
  launchViaSteam: (options: {
    steamAppId: number;
    args?: string[];
  }) => electron.ipcRenderer.invoke("app:launchViaSteam", options) as Promise<boolean>,
  openDevTools: () => electron.ipcRenderer.invoke("app:openDevTools") as Promise<void>,
  setLaunchAtStartup: (enabled: boolean) =>
    electron.ipcRenderer.invoke("app:setLaunchAtStartup", enabled) as Promise<boolean>,
  fetchRemoteJson: (options: {
    url: string;
    proxyUrl?: string;
  }) => electron.ipcRenderer.invoke("net:fetchJson", options) as Promise<Record<string, unknown>>,
  checkAppUpdate: (options: {
    updateUrl: string;
    currentVersion?: string;
    proxyUrl?: string;
  }) => electron.ipcRenderer.invoke("app:checkUpdate", options) as Promise<unknown>,
  // HGMM(2026-09-29):返回 app 版本号(关于页面显示用)
  getAppVersion: () => electron.ipcRenderer.invoke("app:getAppVersion") as Promise<string>,
  // 怀沙:远程公告 HTML(关于页面,主进程 fetch)
  getAboutNotice: () =>
    electron.ipcRenderer.invoke("app:getAboutNotice") as Promise<string>,
  readStore: <T>(fileName: string, fallback: T) =>
    electron.ipcRenderer.invoke("store:read", fileName, fallback) as Promise<T>,
  writeStore: (fileName: string, value: unknown) =>
    electron.ipcRenderer.invoke("store:write", fileName, value) as Promise<boolean>,
  exists: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:exists", targetPath) as Promise<boolean>,
  stat: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:stat", targetPath) as Promise<{
      isDirectory: boolean;
      size: number;
      mtimeMs: number;
    }>,
  remove: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:remove", targetPath) as Promise<boolean>,
  listFiles: (targetPath: string) =>
    electron.ipcRenderer.invoke("fs:listFiles", targetPath) as Promise<string[]>,
  // BUG-010(2026-10-03):读 modRoot 顶层条目(只一层,过滤隐藏文件),
  //   installMod 用来自动探测 modRoot 唯一顶层目录作 targetFolderName
  readDirTopLevel: (options: { path: string }) =>
    electron.ipcRenderer.invoke("tools:readDirTopLevel", options) as Promise<
      Array<{ name: string; isDirectory: boolean }>
    >,
  // BUG-010 round 5(2026-10-03):解析 game 根目录相对偏移(exe 在子目录时上溯到游戏根)。
  //   renderer 无 Node path 模块,只能走 IPC 调主进程的 path.resolve。
  //   巫师 3 witcher3.exe 在 bin/x64_dx12/ → prefix="..\\..\\" → 上溯 2 级到游戏根。
  resolveGamePath: (options: {
    gamePath: string;
    prefix?: string;
  }) => electron.ipcRenderer.invoke("tools:resolveGamePath", options) as Promise<string>,
  // HGMM Phase 5:扫描游戏 mod 安装目录,发现用户手动丢入的 mod
  scanGameMods: (options: {
    gamePath: string;
    // BUG-010 round 5:game 根目录相对偏移(后端权威解析 effectiveGamePath)
    gamePathPrefix?: string;
    targets: Array<{
      modTypeId: string;
      modTypeName: string;
      absPath: string;
      // BUG-010:per-target 扫描扩展名白名单
      scanExtensions?: string[];
    }>;
  }) => electron.ipcRenderer.invoke("tools:scanGameMods", options) as Promise<{
    scannedMods: Array<{
      modTypeId: string;
      modTypeName: string;
      modRoot: string;
      files: string[];
    }>;
  }>,
  // HGMM Phase 2.5:UE4SS/BepInEx 加载器依赖直接解压到游戏目录(绕过 modRoot 中转)
  extractArchive: (options: {
    archivePath: string;
    targetPath: string;
    allowedRoot?: string;
  }) => electron.ipcRenderer.invoke("tools:extractArchive", options) as Promise<{
    files: string[];
    targetPath: string;
  }>,
  // HGMM Phase 2.5:查 UE4SS/BepInEx 加载器包绝对路径(dev:resources/ue4ss/{id}.zip,prod:process.resourcesPath/...)
  getUE4SSPackage: (presetId: string) =>
    electron.ipcRenderer.invoke("tools:getUE4SSPackage", presetId) as Promise<{
      archivePath: string;
      exists: boolean;
    }>,
  // HGMM 3.0:Unity BepInEx 加载器查包路径(镜像 UE4SS 但拆开 IPC)
  getBepInExPackage: (presetId: string) =>
    electron.ipcRenderer.invoke("tools:getBepInExPackage", presetId) as Promise<{
      archivePath: string;
      exists: boolean;
    }>,
  readJsonFile: <T>(targetPath: string) =>
    electron.ipcRenderer.invoke("fs:readJsonFile", targetPath) as Promise<T>,
  writeJsonFile: (targetPath: string, value: unknown) =>
    electron.ipcRenderer.invoke("fs:writeJsonFile", targetPath, value) as Promise<boolean>,
  findFileByName: (options: {
    rootPath: string;
    fileNames: string[];
    maxDepth?: number;
  }) => electron.ipcRenderer.invoke("fs:findFileByName", options) as Promise<string>,
  findSteamGamePath: (steamAppId: number) =>
    electron.ipcRenderer.invoke("steam:findGamePath", steamAppId) as Promise<string>,
  startNexusOAuthLogin: (options?: { proxyUrl?: string }) =>
    electron.ipcRenderer.invoke("nexus:startOAuthLogin", options) as Promise<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      user: {
        key: string;
        name: string;
        email: string;
        profileUrl: string;
        avatar?: string;
        isPremium: boolean;
        isSupporter: boolean;
      };
    }>,
  cancelNexusOAuthLogin: () =>
    electron.ipcRenderer.invoke("nexus:cancelOAuthLogin") as Promise<boolean>,
  validateNexusApiKey: (options: string | { apiKey: string; proxyUrl?: string }) =>
    electron.ipcRenderer.invoke("nexus:validateApiKey", options) as Promise<unknown>,
  listNexusMods: (options: unknown) =>
    electron.ipcRenderer.invoke("nexus:listMods", options) as Promise<unknown>,
  getNexusModDetail: (options: unknown) =>
    electron.ipcRenderer.invoke("nexus:getModDetail", options) as Promise<unknown>,
  getNexusDownloadUrl: (options: unknown) =>
    electron.ipcRenderer.invoke("nexus:getDownloadUrl", options) as Promise<string>,
  refreshNexusAccessToken: (options: { refreshToken: string; proxyUrl?: string }) =>
    electron.ipcRenderer.invoke("nexus:refreshAccessToken", options) as Promise<{
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
    }>,
  translateText: (options: {
    text: string;
    provider: string;
    targetLang: "zh-CN";
    sourceLang?: string;
    proxyUrl?: string;
    baiduAppId?: string;
    baiduSecret?: string;
    youdaoAppKey?: string;
    youdaoSecret?: string;
    tencentSecretId?: string;
    tencentSecretKey?: string;
    tencentRegion?: string;
    volcengineAccessKeyId?: string;
    volcengineSecretAccessKey?: string;
    volcengineRegion?: string;
    ollamaBaseUrl?: string;
    ollamaModel?: string;
    ollamaTimeoutMs?: number;
  }) => electron.ipcRenderer.invoke("translate:text", options) as Promise<string>,
  downloadFile: (options: {
    taskId?: string;
    url: string;
    outputPath: string;
    resume?: boolean;
    proxyUrl?: string;
    engine?: "builtin" | "aria2";
    aria2ExecutablePath?: string;
    aria2MaxConnections?: number;
  }) => electron.ipcRenderer.invoke("downloads:downloadFile", options) as Promise<{
    outputPath: string;
    receivedBytes: number;
    totalBytes: number;
  }>,
  cancelDownload: (taskId: string) =>
    electron.ipcRenderer.invoke("downloads:cancel", taskId) as Promise<boolean>,
  onDownloadProgress: (callback: (data: { taskId: string; receivedBytes: number; totalBytes: number }) => void) => {
    electron.ipcRenderer.on("downloads:progress", (_event, data) => callback(data as any));
  },
  createBackupZip: (options: {
    sourcePath: string;
    outputPath: string;
  }) => electron.ipcRenderer.invoke("backups:createZip", options) as Promise<{
    outputPath: string;
    size: number;
    filesCount: number;
  }>,
  restoreBackupZip: (options: {
    backupPath: string;
    targetPath: string;
  }) => electron.ipcRenderer.invoke("backups:restoreZip", options) as Promise<boolean>,
  listBackupZip: (backupPath: string) =>
    electron.ipcRenderer.invoke("backups:listZip", backupPath) as Promise<Array<{
      path: string;
      isDirectory: boolean;
      size: number;
    }>>,
  exportModPackage: (options: {
    mods: Array<{
      rootPath: string;
      folderName: string;
    }>;
    manifest: Record<string, unknown>;
    outputPath: string;
    operationId?: string;
  }) => electron.ipcRenderer.invoke("package:exportMods", options) as Promise<{
    outputPath: string;
    size: number;
  }>,
  onPackageProgress: (callback: (data: {
    operationId: string;
    operation: "import" | "export";
    phase: string;
    current: number;
    total: number;
    message: string;
  }) => void) => {
    electron.ipcRenderer.on("package:progress", (_event, data) => callback(data as {
      operationId: string;
      operation: "import" | "export";
      phase: string;
      current: number;
      total: number;
      message: string;
    }));
  },
  readPackageManifest: (packagePath: string) =>
    electron.ipcRenderer.invoke("package:readManifest", packagePath) as Promise<Record<string, unknown>>,
  importGamePack: (options: {
    packagePath: string;
    storagePath: string;
    gameName: string;
    overwrite?: boolean;
    operationId?: string;
  }) => electron.ipcRenderer.invoke("package:importGamePack", options) as Promise<{
    manifest: Record<string, unknown>;
    mods: Array<{ folder: string; rootPath: string; files: string[]; coverImage?: string }>;
  }>,
  importModFolder: (options: {
    sourcePath: string;
    storagePath: string;
    gameId: string;
    gameName?: string;
    modId: string;
  }) =>
    electron.ipcRenderer.invoke("mods:importFolder", options) as Promise<{
      rootPath: string;
      files: string[];
      coverImage?: string;
      manifest?: {
        name?: string;
        version?: string;
        author?: string;
        website?: string;
        description?: string;
        tags?: string[];
        requirements?: string[];
      };
    }>,
  // HGMM marker mod(2026-10-04):含 HGMM-MOD-MANIFEST 的压缩包,直接解压到游戏根目录
  importMarkerMod: (options: {
    sourcePath: string;
    effectiveGamePath: string;
    expectedGame: string;
  }) =>
    electron.ipcRenderer.invoke("mods:importMarkerMod", options) as Promise<
      | { kind: "no-marker" }
      | {
          kind: "marker";
          extractedTo: string;
          manifest: { game: string; version: string; created: string };
        }
    >,
  // BUG-022(2026-10-05):精选 mod subFile 平铺部署 — 把 modRoot 整个 cp 到
  //   <effectiveGamePath>/<installPath>/ 下,不嵌套、不做 targetFolderName 探测
  flattenDeploy: (options: {
    modRoot: string;
    effectiveGamePath: string;
    installPath: string;
  }) =>
    electron.ipcRenderer.invoke("mods:flattenDeploy", options) as Promise<{
      targetDir: string;
      deployedFrom: string;
    }>,
  copyModCoverImage: (options: {
    sourcePath: string;
    modRoot: string;
  }) => electron.ipcRenderer.invoke("mods:copyCoverImage", options) as Promise<{
    coverImage: string;
  }>,
  migrateModCoverImage: (options: {
    modRoot: string;
    coverImage: string;
  }) => electron.ipcRenderer.invoke("mods:migrateCoverImage", options) as Promise<{
    coverImage: string;
  }>,
  migrateModCacheFolder: (options: {
    sourcePath: string;
    storagePath: string;
    gameName: string;
    folderName: string;
  }) =>
    electron.ipcRenderer.invoke("mods:migrateCacheFolder", options) as Promise<{
      rootPath: string;
      files: string[];
      coverImage?: string;
      manifest?: {
        name?: string;
        version?: string;
        author?: string;
        website?: string;
        description?: string;
        tags?: string[];
        requirements?: string[];
      };
    }>,
  installMod: (options: {
    modRoot: string;
    gamePath: string;
    installPath: string;
  }) => electron.ipcRenderer.invoke("mods:install", options) as Promise<boolean>,
  uninstallMod: (options: {
    modRoot: string;
    gamePath: string;
    installPath: string;
  }) => electron.ipcRenderer.invoke("mods:uninstall", options) as Promise<boolean>,
  // HGMM absolute mod:解压前清空目标目录
  cleanDirectory: (options: {
    targetPath: string;
  }) => electron.ipcRenderer.invoke("mods:cleanDirectory", options) as Promise<boolean>,
  applyModStrategy: (options: {
    modRoot: string;
    gamePath: string;
    // BUG-010 round 5(2026-10-03):exe 在子目录时上溯到游戏根
    gamePathPrefix?: string;
    targetFolderName?: string;
    strategy: unknown;
    isInstall: boolean;
    useSymlink?: boolean;
    managedToolCandidates?: string[];
  }) => electron.ipcRenderer.invoke("mods:applyStrategy", options) as Promise<{
    deployedFiles: string[];
  }>,
  createInstallPlan: (options: {
    modRoot: string;
    gamePath: string;
    // BUG-010 round 5:exe 在子目录时上溯到游戏根
    gamePathPrefix?: string;
    targetFolderName?: string;
    strategy: unknown;
    useSymlink?: boolean;
  }) => electron.ipcRenderer.invoke("mods:createInstallPlan", options) as Promise<{
    targetFiles: string[];
    conflicts: string[];
  }>,
  removeDeployedFiles: (options: {
    gamePath: string;
    deployedFiles: string[];
  }) => electron.ipcRenderer.invoke("mods:removeDeployedFiles", options) as Promise<boolean>,
  onNxmOpen: (handler: (url: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => handler(url);
    electron.ipcRenderer.on("nxm:open", listener);

    return () => electron.ipcRenderer.removeListener("nxm:open", listener);
  }
});
