# 架构说明

## 进程划分

- `electron/main.ts`：Electron 主进程，负责文件系统、压缩包、启动游戏、Steam 定位、Nexus 请求、备份和下载。
- `electron/preload.ts`：安全暴露 IPC 到 `window.mayfly`。
- `src/App.vue`：当前渲染层主界面。
- `src/stores/library.ts`：Pinia store，负责应用状态、持久化、业务流程。

## 数据存储

主数据文件为 Electron `userData/data/mayfly-library.json`，包含：

- 设置
- 游戏列表
- 本地 Mod 列表
- 下载任务
- 备份记录
- 日志

导入的 Mod 文件复制到用户设置的 `storagePath/mods/<gameId>/<modId>`。

## 安装规则

每个游戏通过 `GameAdapter` 提供 `modTypes` 和 `checkModType(files)`。
安装时根据 Mod 类型拿到 `InstallStrategy`，再由主进程执行文件复制、软链、删除和回滚。

## NexusMods

只接 NexusMods：

- API Key 校验：`/v1/users/validate.json`
- 列表：Nexus GraphQL
- 详情：`/v1/games/{domain}/mods/{modId}.json`
- 文件：`/v1/games/{domain}/mods/{modId}/files.json`
- 下载链接：`/download_link.json`

如果 Nexus 不返回直链，则打开 Nexus 文件网页。
