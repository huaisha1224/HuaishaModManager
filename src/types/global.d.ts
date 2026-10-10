export {};

// Vite:声明 .md?raw 导入类型(把 markdown 文件当字符串引入)
// ?raw 后缀让 Vite 把文件当字符串打包,这里只补 TypeScript 类型
// 通配符 * 不跨斜杠,*?raw 覆盖任意路径的 raw 资源(md / txt / json 都行)
declare module "*?raw" {
  const content: string;
  export default content;
}

declare global {
  interface Window {
    mayfly: {
      // 怀沙:showAlert 已废弃,改用 src/services/dialog.ts 的 appAlert 主题弹窗
      openDirectory: (options?: { title?: string }) => Promise<string>;
      openExecutable: (options?: { title?: string }) => Promise<string>;
      openImage: () => Promise<string>;
      openArchive: () => Promise<string[]>;
      openModSource: () => Promise<string[]>;
      openJson: () => Promise<string>;
      saveJson: (defaultPath: string) => Promise<string>;
      saveFile: (options: {
        defaultPath: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<string>;
      getPathForFile: (file: File) => string;
      openPath: (targetPath: string) => Promise<boolean>;
      openExternal: (targetUrl: string) => Promise<boolean>;
      fileUrl: (targetPath: string) => Promise<string>;
      launchExecutable: (options: {
        executablePath: string;
        cwd?: string;
        args?: string[];
      }) => Promise<boolean>;
      launchViaSteam: (options: {
        steamAppId: number;
        args?: string[];
      }) => Promise<boolean>;
      openDevTools: () => Promise<void>;
      setLaunchAtStartup: (enabled: boolean) => Promise<boolean>;
      fetchRemoteJson: (options: {
        url: string;
        proxyUrl?: string;
      }) => Promise<Record<string, unknown>>;
      checkAppUpdate: (options: {
        updateUrl: string;
        currentVersion?: string;
        proxyUrl?: string;
      }) => Promise<import("./domain").AppUpdateCheckResult>;
      // HGMM(2026-09-29):返回 app 版本号(关于页面显示)
      getAppVersion: () => Promise<string>;
      // 怀沙:远程公告 HTML(关于页面,主进程 fetch ABOUT_NOTICE_URL)
      getAboutNotice: () => Promise<string>;
      readStore: <T>(fileName: string, fallback: T) => Promise<T>;
      writeStore: (fileName: string, value: unknown) => Promise<boolean>;
      exists: (targetPath: string) => Promise<boolean>;
      stat: (targetPath: string) => Promise<{
        isDirectory: boolean;
        size: number;
        mtimeMs: number;
      }>;
      remove: (targetPath: string) => Promise<boolean>;
      listFiles: (targetPath: string) => Promise<string[]>;
      // BUG-010(2026-10-03):读 modRoot 顶层条目(只一层,过滤隐藏文件),
      //   installMod 用来自动探测 modRoot 唯一顶层目录作 targetFolderName
      readDirTopLevel: (options: { path: string }) => Promise<
        Array<{ name: string; isDirectory: boolean }>
      >;
      // BUG-010(2026-10-03):解析 game 根目录相对偏移(exe 在子目录时上溯到游戏根)
      //   巫师 3 witcher3.exe 在 bin/x64_dx12/,prefix="..\\..\\" → 上溯到游戏根
      //   renderer 没 Node path 模块,只能走 IPC
      resolveGamePath: (options: { gamePath: string; prefix?: string }) => Promise<string>;
      // HGMM Phase 5:扫描游戏 mod 安装目录,发现用户手动丢入的 mod
      scanGameMods: (options: {
        gamePath: string;
        // BUG-010:game 根目录相对偏移(exe 在子目录时上溯到游戏根)
        gamePathPrefix?: string;
        targets: Array<{
          modTypeId: string;
          modTypeName: string;
          absPath: string;
          // BUG-010:per-target 扫描扩展名白名单(覆盖默认 SCAN_MOD_FILE_EXTENSIONS)
          scanExtensions?: string[];
        }>;
      }) => Promise<{
        scannedMods: Array<{
          modTypeId: string;
          modTypeName: string;
          modRoot: string;
          files: string[];
        }>;
      }>;
      // HGMM Phase 2.5:UE4SS/BepInEx 加载器依赖直接解压到游戏目录
      extractArchive: (options: {
        archivePath: string;
        targetPath: string;
        allowedRoot?: string;
      }) => Promise<{
        files: string[];
        targetPath: string;
      }>;
      // HGMM absolute mod 专用:解压前清空目标目录(防重复安装残留)
      cleanDirectory: (options: { targetPath: string }) => Promise<boolean>;
      // HGMM Phase 2.5:查 UE4SS/BepInEx 加载器包路径
      getUE4SSPackage: (presetId: string) => Promise<{
        archivePath: string;
        exists: boolean;
      }>;
      // HGMM 3.0:Unity BepInEx 加载器查包(镜像 getUE4SSPackage,但拆开为独立 IPC)
      getBepInExPackage: (presetId: string) => Promise<{
        archivePath: string;
        exists: boolean;
      }>;
      readJsonFile: <T>(targetPath: string) => Promise<T>;
      writeJsonFile: (targetPath: string, value: unknown) => Promise<boolean>;
      findFileByName: (options: {
        rootPath: string;
        fileNames: string[];
        maxDepth?: number;
      }) => Promise<string>;
      findSteamGamePath: (steamAppId: number) => Promise<string>;
      validateNexusApiKey: (options: string | {
        apiKey: string;
        proxyUrl?: string;
      }) => Promise<import("./domain").NexusUser>;
      startNexusOAuthLogin: (options?: { proxyUrl?: string }) => Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
        user: import("./domain").NexusUser;
      }>;
      cancelNexusOAuthLogin: () => Promise<boolean>;
      listNexusMods: (options: {
        apiKey: string;
        accessToken?: string;
        gameDomain: string;
        page: number;
        pageSize: number;
        proxyUrl?: string;
        searchText?: string;
        sort?: "default" | "updatedAt" | "createdAt" | "downloads";
        facets?: {
          categoryName?: string;
          languageName?: string;
          tag?: string;
        };
      }) => Promise<import("./domain").NexusModListResult>;
      getNexusModDetail: (options: {
        apiKey: string;
        accessToken?: string;
        gameDomain: string;
        modId: string;
        proxyUrl?: string;
      }) => Promise<import("./domain").NexusModDetail>;
      getNexusDownloadUrl: (options: {
        apiKey: string;
        accessToken?: string;
        gameDomain: string;
        modId: string;
        fileId: string;
        proxyUrl?: string;
        key?: string;
        expires?: string;
      }) => Promise<string>;
      // HGMM Phase 5.x:用 OAuth refreshToken 换新 accessToken,避免 1h 过期后要求重登
      refreshNexusAccessToken: (options: {
        refreshToken: string;
        proxyUrl?: string;
      }) => Promise<{
        accessToken: string;
        refreshToken: string;
        expiresAt: number;
      }>;
      translateText: (options: {
        text: string;
        provider: import("./domain").AppSettings["translationProvider"];
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
      }) => Promise<string>;
      downloadFile: (options: {
        taskId?: string;
        url: string;
        outputPath: string;
        resume?: boolean;
        proxyUrl?: string;
        engine?: import("./domain").AppSettings["downloadEngine"];
        aria2ExecutablePath?: string;
        aria2MaxConnections?: number;
      }) => Promise<{
        outputPath: string;
        receivedBytes: number;
        totalBytes: number;
      }>;
      cancelDownload: (taskId: string) => Promise<boolean>;
      onDownloadProgress: (callback: (data: { taskId: string; receivedBytes: number; totalBytes: number }) => void) => void;
      createBackupZip: (options: {
        sourcePath: string;
        outputPath: string;
      }) => Promise<{
        outputPath: string;
        size: number;
        filesCount: number;
      }>;
      restoreBackupZip: (options: {
        backupPath: string;
        targetPath: string;
      }) => Promise<boolean>;
      listBackupZip: (backupPath: string) => Promise<Array<{
        path: string;
        isDirectory: boolean;
        size: number;
      }>>;
      exportModPackage: (options: {
        mods: Array<{
          rootPath: string;
          folderName: string;
        }>;
        manifest: Record<string, unknown>;
        outputPath: string;
        operationId?: string;
      }) => Promise<{
        outputPath: string;
        size: number;
      }>;
      onPackageProgress: (callback: (data: {
        operationId: string;
        operation: "import" | "export";
        phase: string;
        current: number;
        total: number;
        message: string;
      }) => void) => void;
      readPackageManifest: (packagePath: string) => Promise<Record<string, unknown>>;
      importGamePack: (options: {
        packagePath: string;
        storagePath: string;
        gameName: string;
        overwrite?: boolean;
        operationId?: string;
      }) => Promise<{
        manifest: Record<string, unknown>;
        mods: Array<{ folder: string; rootPath: string; files: string[]; coverImage?: string }>;
      }>;
      importModFolder: (options: {
        sourcePath: string;
        storagePath: string;
        gameId: string;
        gameName?: string;
        modId: string;
      }) => Promise<{
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
      }>;
      // HGMM marker mod(2026-10-04):压缩包内含 HGMM-MOD-MANIFEST,直接解压到游戏根目录
      importMarkerMod: (options: {
        sourcePath: string;
        effectiveGamePath: string;
        expectedGame: string;
      }) => Promise<
        | { kind: "no-marker" }
        | {
            kind: "marker";
            extractedTo: string;
            manifest: { game: string; version: string; created: string };
          }
      >;
      // BUG-022(2026-10-05):精选 mod subFile 平铺部署
      flattenDeploy: (options: {
        modRoot: string;
        effectiveGamePath: string;
        installPath: string;
      }) => Promise<{
        targetDir: string;
        deployedFrom: string;
      }>;
      copyModCoverImage: (options: {
        sourcePath: string;
        modRoot: string;
      }) => Promise<{
        coverImage: string;
      }>;
      migrateModCoverImage: (options: {
        modRoot: string;
        coverImage: string;
      }) => Promise<{
        coverImage: string;
      }>;
      migrateModCacheFolder: (options: {
        sourcePath: string;
        storagePath: string;
        gameName: string;
        folderName: string;
      }) => Promise<{
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
      }>;
      installMod: (options: {
        modRoot: string;
        gamePath: string;
        installPath: string;
      }) => Promise<boolean>;
      uninstallMod: (options: {
        modRoot: string;
        gamePath: string;
        installPath: string;
      }) => Promise<boolean>;
      applyModStrategy: (options: {
        modRoot: string;
        gamePath: string;
        // BUG-010:game 根目录相对偏移(exe 在子目录时上溯到游戏根)
        gamePathPrefix?: string;
        targetFolderName?: string;
        strategy: import("./domain").InstallStrategy;
        isInstall: boolean;
        useSymlink?: boolean;
        managedToolCandidates?: string[];
      }) => Promise<{
        deployedFiles: string[];
      }>;
      createInstallPlan: (options: {
        modRoot: string;
        gamePath: string;
        // BUG-010:game 根目录相对偏移
        gamePathPrefix?: string;
        targetFolderName?: string;
        strategy: import("./domain").InstallStrategy;
        useSymlink?: boolean;
      }) => Promise<import("./domain").InstallPlan>;
      removeDeployedFiles: (options: {
        gamePath: string;
        deployedFiles: string[];
      }) => Promise<boolean>;
      onNxmOpen: (handler: (url: string) => void) => () => void;
    };
  }
}
