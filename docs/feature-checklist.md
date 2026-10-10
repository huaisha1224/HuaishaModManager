# mayflyMods 任务单

目标：用 Electron 构建一个桌面端 Mod 管理器，代码按 Electron 主进程、preload IPC、Vue 渲染进程组织。

当前范围：

- 保留：本地 Mod 管理、游戏库、游戏适配、NexusMods 浏览/授权/下载、下载队列、备份、设置、关于。
- 不做：第三方 Mod 站、Thunderstore、mod.io、CurseForge、GameBanana、AI 对话、MCP、Skills、上传 Mod 包到平台。

使用规则：

- `[x]` 表示已完成并通过当前项目验证。
- `[ ]` 表示未完成。
- 每做完一个任务，就在这里打钩。
- 不急着补齐所有游戏的特殊规则，先按阶段把基础能力打稳。

## 0. 项目基础

- [x] 新建 Electron 项目目录 `mayfly-mod-manager-electron`
- [x] 配置 `Electron + Vite + Vue 3 + TypeScript + Pinia`
- [x] 配置主进程、preload、渲染进程构建入口
- [x] 修复 Windows 环境下 `ELECTRON_RUN_AS_NODE=1` 导致 Electron 被当 Node 运行的问题
- [x] 添加 `npm run dev`
- [x] 添加 `npm run typecheck`
- [x] 添加 `npm run build`
- [x] `npm run typecheck` 通过
- [x] `npm run build` 通过
- [x] 添加打包发布工具，例如 `electron-builder`
- [x] 生成 Windows 安装包
- [x] 配置应用图标、名称、版本号
- [x] 配置窗口状态持久化

## 1. 文档与范围控制

- [x] 梳理 Mod 管理器功能范围
- [x] 将调研文档改成任务单
- [x] 明确第一阶段先做本地 Mod 管理
- [x] 明确暂缓大规模游戏特殊规则补齐
- [x] 明确线上源只保留 NexusMods
- [x] 明确排除 第三方 Mod 站
- [x] 明确排除 AI/MCP/Skills
- [x] 明确排除 Thunderstore/mod.io/CurseForge/GameBanana
- [x] 每完成一个任务同步更新本任务单
- [x] 增加开发说明 `README.md`
- [x] 增加运行与打包说明文档
- [x] 增加架构说明文档
- [x] 增加游戏适配编写规范

## 2. 基础桌面 UI

- [x] 实现左侧导航
- [x] 实现本地管理页
- [x] 实现设置页
- [x] 实现功能清单入口
- [x] 实现游戏库区域
- [x] 实现 Mod 列表区域
- [x] 实现搜索框
- [x] 实现基础深色桌面工具样式
- [x] 实现游戏预设搜索弹层
- [x] 显示当前游戏基础信息
- [x] 显示 Mod 类型
- [x] 支持手动切换 Mod 类型
- [ ] 拆分 `App.vue` 为独立页面和组件
- [x] 增加 Toast/消息提示
- [x] 增加确认弹窗
- [x] 增加空状态、错误状态、加载状态统一组件
- [x] 增加列表/网格视图切换
- [ ] 增加响应式细节优化

## 3. 本地数据与持久化

- [x] 定义 `ManagedGame`
- [x] 定义 `LocalMod`
- [x] 定义 `GamePreset`
- [x] 定义 `GameAdapter`
- [x] 定义 `ModTypeRule`
- [x] 定义 `InstallStrategy`
- [x] 使用 Electron `userData` 存储本地 JSON 数据
- [x] 保存设置、游戏列表、当前游戏、Mod 列表
- [x] 启动时读取本地数据
- [x] 保存 Mod 安装状态
- [x] 兼容旧 Mod 数据缺少 `modTypeId` 的情况
- [x] 将数据按游戏拆分成独立 `mod.json`
- [x] 兼容 历史数字 `modType` 到当前 adapter 类型
- [x] 增加数据版本号
- [x] 增加数据迁移机制
- [x] 增加数据导入/导出
- [x] 增加数据备份恢复

## 4. 游戏库

- [x] 支持手动添加游戏目录
- [x] 支持从预设游戏添加游戏
- [x] 支持搜索预设游戏
- [x] 支持切换当前游戏
- [x] 支持打开游戏目录
- [x] 支持删除游戏配置
- [x] 生成 144 个游戏预设入口
- [x] 前台隐藏 `GTA5` / `GTA5 Enhanced`，当前可添加游戏显示为 142 个
- [x] 预设包含游戏名、内部目录 ID、Steam AppID、exe、封面、类型名
- [x] 预设包含 NexusMods domain 和 Nexus game_id
- [x] 统计并保留带 Nexus 配置的游戏入口
- [x] 补充 `GTA5`（当前隐藏）
- [x] 补充 `GTA5 Enhanced`（当前隐藏）
- [x] 校验所选目录是否包含对应游戏 exe
- [x] 自动识别 Steam 游戏安装路径
- [x] 支持选择 exe 后反推游戏根目录
- [x] 支持编辑游戏名称
- [x] 支持编辑游戏路径
- [x] 支持编辑启动项
- [x] 支持启动游戏
- [x] 支持打开 Mod 存储目录
- [x] 支持自定义游戏完整表单
- [x] 支持自定义游戏封面

## 5. 本地 Mod 导入

- [x] 支持选择本地文件夹导入
- [x] 支持选择单文件导入
- [x] 导入时复制到 Mod 存储目录
- [x] 导入后扫描文件列表
- [x] 导入后生成 Mod 记录
- [x] 导入后根据 adapter 自动识别 Mod 类型
- [x] 导入后保存文件列表
- [x] 支持搜索本地 Mod
- [x] 支持删除本地 Mod 缓存目录
- [x] 支持打开单个 Mod 缓存目录
- [x] 支持拖拽导入文件夹
- [x] 支持拖拽导入文件
- [x] 支持 zip 解压导入
- [x] 支持 7z 解压导入
- [x] 支持 rar 解压导入
- [x] 支持 `.mmp` 包导入
- [x] 导入时读取 `manifest.json`
- [x] 导入时读取封面图
- [x] 导入时自动识别版本号
- [x] 导入时自动识别作者
- [x] 导入重复检测
- [x] 导入覆盖/保留两份选择

## 6. Mod 管理

- [x] 显示 Mod 名称
- [x] 显示 Mod 文件数量与首个文件
- [x] 显示 Mod 缓存路径
- [x] 显示 Mod 安装状态
- [x] 支持编辑 Mod 名称
- [x] 支持手动切换 Mod 类型
- [x] 支持安装单个 Mod
- [x] 支持卸载单个 Mod
- [x] 支持删除单个 Mod
- [x] 支持记录安装部署文件
- [x] 卸载时优先按部署记录删除
- [x] 支持查看部署文件列表
- [x] 支持安装计划预览
- [x] 支持按类型筛选
- [x] 支持多选
- [x] 支持批量安装
- [x] 支持批量卸载
- [x] 支持批量删除
- [x] 支持编辑版本号
- [x] 支持编辑作者
- [x] 支持编辑来源网址
- [x] 支持编辑描述字段
- [x] 支持标签
- [x] 支持标签颜色
- [x] 支持按类型筛选
- [x] 支持按标签筛选
- [x] 支持多选
- [x] 支持批量安装
- [x] 支持批量卸载
- [x] 支持批量删除
- [x] 支持批量编辑
- [x] 支持排序/权重
- [x] 支持 Mod 自身前置备注字段
- [x] 取消 Mod 分组功能，保留“标签 + 配置档案”作为分类和一键切换方案
- [x] 定义游戏 Mod 配置档案数据结构
- [x] 保存配置档案中的启用 Mod 列表
- [x] 保存配置档案中的 Mod 排序
- [x] 支持新建、重命名、删除配置档案
- [x] 支持一键应用整套 Mod 配置档案
- [x] 应用档案时自动卸载多余 Mod
- [x] 应用档案时按档案顺序安装 Mod
- [x] 配置档案随数据导入/导出保存
- [ ] 安装前检查本地前置依赖（按当前需求暂不做）
- [x] 支持冲突检测
- [x] 支持 Nexus 来源 Mod 更新检查、手动更新和批量更新
- [x] 支持 NXM 深链

## 7. 安装策略与文件操作

- [x] 实现 Electron 主进程文件 IPC
- [x] 实现选择目录 IPC
- [x] 实现打开路径 IPC
- [x] 实现读取/写入 JSON store IPC
- [x] 实现扫描文件列表
- [x] 实现复制导入源到缓存目录
- [x] 实现通用安装 `general`
- [x] 实现通用卸载
- [x] 实现按文件夹安装 `folder`
- [x] 实现按文件安装 `file`
- [x] 实现按同级文件安装 `fileSibling`
- [x] 实现按父文件夹安装 `folderParent`
- [x] 实现手动类型 `manual`
- [x] 安装/卸载改为通过 `InstallStrategy` 执行
- [x] 实现跳过元文件 `README.md / manifest.json / icon.png / LICENSE`
- [x] 实现软链安装
- [x] 实现关闭软链安装设置
- [x] 卸载后清理空目录
- [x] 安装前生成文件变更计划
- [x] UI 可查看安装前文件变更计划
- [x] 安装前检测覆盖风险
- [x] 安装失败回滚
- [x] 记录每次安装写入了哪些目标文件
- [x] 安装/卸载路径限制在游戏目录内
- [x] 无部署记录卸载前确认
- [x] zip 导入防路径穿越

## 8. 游戏适配体系

- [x] 建立 `src/adapters`
- [x] 建立 `commonAdapter`
- [x] 建立 `createCatalogAdapter`
- [x] 建立 `getGameAdapter`
- [x] 建立 `getModType`
- [x] 建立 `checkModType(files)` 接口
- [x] 建立 `modTypes` 类型规则
- [x] 建立 adapter 工具函数：文件名、扩展名、路径片段判断
- [x] 已接入 `Cyberpunk 2077` adapter
- [x] 已接入通用 Unreal adapter
- [x] 已接入通用 Unity adapter
- [x] 已接入通用 MelonLoader adapter
- [x] 已给 `Black Myth Wukong` 接入 Unreal 规则
- [x] 已给 `ELDEN RING` 接入 Unreal 规则占位
- [x] 已给 `Hogwarts Legacy` 接入 Unreal 规则
- [x] 已给 `Stellar Blade` 接入 Unreal 规则
- [x] 已给 Unreal/`Stellar Blade` 补齐 `LogicMods` 类型
- [x] 已给 `Tekken 8` 接入 Unreal 规则
- [x] 已给 `Risk of Rain 2` 接入 Unity 规则
- [x] 已给 `Valheim` 接入 Unity 规则
- [x] 已给 `Lethal Company` 接入 Unity 规则
- [x] 逐个核对 144 个游戏预设 ID 是否和 adapter 匹配
- [x] 批量补齐数据化安装规则
- [x] 补齐剩余 63 个 catalogued 游戏的数据化安装规则
- [x] adapter 校验达到 144 / 144
- [x] 实现 `Elden Ring` 专属规则
- [x] 实现 `Black Myth Wukong` 专属规则
- [x] 实现 `Monster Hunter World` 专属规则
- [x] 修正 `Monster Hunter World` 插件安装到 `nativePC/plugins`
- [x] 实现 `Monster Hunter Rise` 专属规则
- [x] 实现 `Monster Hunter Wilds` 专属规则
- [x] 实现 `Skyrim Special Edition` 专属规则
- [x] 实现 `Stardew Valley` 专属规则
- [x] 实现 `Tale of Immortal` 专属规则
- [x] 实现 `Baldur's Gate 3` 专属规则
- [x] 实现 `GTA5` 专属规则（当前隐藏）
- [x] 实现 `GTA5 Enhanced` 专属规则（当前隐藏）
- [x] 实现 RE Engine 通用适配
- [x] 实现 GTA5 `dlc.rpf` DLC 包落位规则
- [ ] 实现 GTA5 `update.rpf` 内部 XML 写入规则（GTA5 当前隐藏，暂不做）
- [x] 实现游戏专属排序
- [x] 支持用户自定义 adapter
- [x] 自定义 adapter 添加时提供文件夹风格的规则模拟页面
- [x] 可视化显示识别条件和识别出的 Mod 类型
- [x] 可视化显示预计安装文件和目标路径
- [x] 可视化显示模拟模式下的冲突检查提示
- [x] 明确模拟预览不会修改游戏文件，实际安装前再次检查覆盖风险

### 8.1 已有落位规则但未完整还原特殊逻辑的游戏

说明：`144 / 144` 表示所有预设游戏都有基础 adapter，且不会退回 `common` 通用兜底；前台当前隐藏 `GTA5` / `GTA5 Enhanced`，用户可添加列表显示 142 个。前置检测按当前需求暂不做，不计入 adapter 未完成项。

- [ ] `GTA5` / `GTA5 Enhanced`：已隐藏；`gameconfig.xml` 写入 `update.rpf/common/data/gameconfig.xml`、车辆/人物文件写入 RPF 容器、`oiv` 脚本执行、RPF 工具链接入暂不做。
- [x] `Baldur's Gate 3`：已按 专属方案还原 `.pak` 安装到用户 AppData，并通过已导入的 `BaldursGate3.dll` 读取 `.pak` 元数据、维护 `modsettings.lsx`。
- [x] `Dying Light 2`：已还原 `.pak -> dataN.pak` 编号安装，并维护本地 `pakList.txt` 映射。
- [x] `Watch Dogs 2`：已还原 `.dat/.fat -> patchN.dat/fat` 成对编号安装，并维护本地 `pakList.txt` 映射。
- [x] `Starfield`：已写 `Starfield.ini`、维护 AppData `plugins.txt`、处理 `sTestFile`；安装前前置检测当前不做。
- [x] `Skyrim Special Edition`：已写 `Skyrim.ini` 并维护 AppData `plugins.txt`。
- [x] `Fallout 4`：已写 `Fallout4.ini` 并维护 AppData `plugins.txt`。
- [x] `No Man's Sky`：安装前已把 `DISABLEMODS.TXT` 改名备份以启用 Mod。
- [x] `Oblivion Remastered`：已维护 `Plugins.txt`。
- [x] `Red Dead Redemption 2`：已还原 `install.xml` 读取和 `lml/mods.xml` 写入，支持 `lml` 与带 `install.xml` 的 `asi` 启用/关闭同步。
- [x] `InZOI`：已修改 `mod_manifest.json` 启用 Mod。
- [x] `MiChangSheng`：已生成/补齐 `Mod.bin`，并按类型创建目录链接或复制 dll。
- [x] `Armored Core 6`：已实现 `ArmoredCore6Dictionary.txt` 字典映射，普通 Mod 会按字典落位到 `mods`；安装前前置检测当前不做。
- [x] `Elden Ring`：已实现 `EldenRingDictionary.txt` 字典映射；安装前前置检测当前不做。
- [x] `Monster Hunter World`：专属安装规则已实现；安装前前置检测当前不做。
- [x] `Resident Evil Village` / `Street Fighter 6`：RE Engine 安装规则已实现；安装前前置检测当前不做。
- [x] `Sekiro`：已实现 `SekiroDictionary.txt` 字典映射，基础类型会按字典落位到 `mods`；安装前前置检测当前不做。
- [x] `Legend of Heroes Three Kingdoms`：已实现 `ThreeKingdomDictionary.txt` Data 字典映射，并支持 Portraits 头像目录软链到 `ThreeKingdom_Data/StreamingAssets/Portraits`。
- [x] `Nioh 2`：安装规则已实现；安装前前置检测当前不做。
- [x] `Like A Dragon 8`：安装规则已实现；安装前前置检测当前不做。

## 9. 设置

- [x] 支持设置 Mod 存储路径
- [x] 支持打开 Mod 存储路径
- [x] 支持主题切换
- [x] 支持语言设置
- [x] 支持默认启动页
- [x] 支持下载后自动导入开关
- [x] 支持通过目录选择游戏开关
- [x] 支持开机自启
- [x] 支持游戏运行时可修改开关
- [x] 支持关闭软链安装开关
- [x] 支持调试模式
- [x] 支持显示调试信息
- [x] 支持启动时检查应用更新
- [x] 接入应用更新 JSON 检查
- [x] 支持设置应用更新地址，地址后续可直接填写
- [x] 支持比较本地版本与线上 `versionName`
- [x] 支持显示更新弹窗、更新日志和强制更新提示
- [x] 支持点击更新后打开线上 `downloadUrl`

应用更新 JSON 示例：

```json
{
  "versionName": "1.3.1",
  "downloadUrl": "https://example.com/download",
  "updateLog": "这里写更新内容",
  "forceUpdate": false
}
```

## 10. 备份系统

- [x] 定义备份数据结构
- [x] 支持游戏目录备份
- [x] 支持存档目录备份
- [x] 支持读取文件树
- [x] 支持选择备份文件
- [x] 支持创建备份压缩包
- [x] 支持恢复备份
- [x] 支持删除备份
- [x] 支持重命名备份
- [x] 支持查看备份内容

## 11. 下载系统

- [x] 定义下载任务数据结构
- [x] 支持自定义 URL 下载
- [x] 支持下载进度
- [x] 支持暂停下载
- [x] 支持继续下载
- [x] 支持删除下载任务
- [x] 支持下载完成自动导入
- [x] 支持重复任务检测
- [x] 支持代理设置
- [x] 接入可选 aria2 下载引擎
- [x] 支持设置 aria2c.exe 路径和最大连接数
- [x] aria2 下载支持进度、暂停、继续和失败提示
- [ ] 保存 aria2 任务快照（暂缓）
- [ ] 恢复 aria2 历史任务（暂缓）

## 12. Mod 探索与第三方平台

- [x] 建立探索页
- [x] 建立 Mod 详情页
- [x] 接入 NexusMods 网页 OAuth 登录（API Key 作为备用方式）
- [x] 接入 NexusMods 列表
- [x] 接入 NexusMods 详情
- [x] 接入 NexusMods 文件列表
- [x] 接入 NexusMods 下载链接解析
- [x] 接入 NXM 深链
- [x] 游戏预设已保存 NexusMods domain
- [x] 游戏预设已保存 NexusMods game_id
- [x] UI 已显示当前游戏 Nexus 配置
- [x] 支持搜索
- [x] 支持筛选
- [x] 支持分页
- [x] 支持选择资源下载
- [x] 支持打开源网页
- [x] 支持 Nexus 页面实验性翻译：列表名称/摘要、详情名称/摘要/说明、分类/标签、文件名/文件分类、Google 免费接口、百度翻译、有道智云、腾讯云机器翻译、火山引擎机器翻译、Ollama 本地模型、串行请求、本地缓存、原文/译文切换

排除项：

- [x] 不接入 其它第三方 Mod 列表
- [x] 不接入 其它第三方 Mod 详情
- [x] 不接入 其它第三方 下载资源
- [x] 不接入 Thunderstore
- [x] 不接入 mod.io
- [x] 不接入 CurseForge
- [x] 不接入 GameBanana

## 13. `.mmp` 包

- [x] 定义 `.mmp` 包结构
- [x] 支持读取 `.mmp` 包信息
- [ ] 支持选择 `.mmp` 子包（暂缓）
- [x] 支持导入 `.mmp` 包
- [ ] 支持导出单个 Mod 为 `.mmp`（暂缓）
- [ ] 支持导出多个 Mod 为 `.mmp`（暂缓）
- [ ] 支持填写 `.mmp` 包名、作者、版本、描述（暂缓）
- [x] 支持 `.mmp` 包重复检测

## 14. AI 与 MCP

- [x] 不做 AI 配置：baseUrl
- [x] 不做 AI 配置：apiKey
- [x] 不做 AI 配置：模型选择
- [x] 不做 AI 聊天页
- [x] 不做 AI 会话历史
- [x] 不做 AI 附件
- [x] 不做 AI 图片输入
- [x] 不做内置 Skills
- [x] 不做 MCP 服务
- [x] 不做 MCP 工具开关
- [x] 不做 MCP 资源开关
- [x] 不做 MCP Prompts 开关
- [x] 不做 VS Code MCP 配置生成

## 15. 用户与平台账号

- [x] NexusMods 网页 OAuth 登录和 API Key 登录
- [ ] NexusMods OAuth 长期 Token 刷新和完整稳定性验证
- [x] NexusMods 用户信息展示
- [x] 清除 NexusMods 授权
- [x] 保存 NexusMods API Key
- [x] 校验 NexusMods API Key
- [x] 不做 其它第三方 Key 配置
- [x] 不做平台账号密码登录
- [x] 不做上传 Mod 包到平台

## 16. 质量验证

- [x] 当前 TypeScript 类型检查通过
- [x] 当前生产构建通过
- [x] 为主进程文件操作添加单元测试
- [x] 为 adapter 识别规则添加单元测试
- [x] 为导入流程添加测试
- [x] 为安装/卸载流程添加测试
- [ ] 添加 Playwright 界面冒烟测试
- [x] 用真实 Mod 文件夹测试 Cyberpunk 2077
- [x] 用真实 Mod 文件夹测试 Unreal 游戏
- [x] 用真实 Mod 文件夹测试 Unity 游戏
- [x] 用真实压缩包测试解压导入
- [x] 测试卸载不会误删非本 Mod 文件

## 17. 当前完成摘要

当前已经完成：

- Electron + Vue 3 + Pinia 项目骨架、构建和 Windows 打包配置。
- 本地游戏库、Mod 导入、扫描、安装、卸载、软链和冲突检测。
- 144 个游戏预设基础 adapter，当前前台显示 142 个，GTA5 / GTA5 Enhanced 已隐藏。
- Baldur's Gate 3、星露谷物语、剑星、怪物猎人世界、鬼谷八荒等重点游戏规则。
- NexusMods 列表、详情、文件选择、NXM 深链、下载和网页 OAuth/API Key 登录。
- Nexus 来源 Mod 更新检查、手动更新和批量更新。
- Google、百度、有道、腾讯、火山引擎和 Ollama 翻译。
- 游戏/存档备份恢复、数据导入导出、Mod 整合包导入。
- 内置下载和可选 aria2 下载引擎。
- 应用启动时检查软件更新。

当前仍暂缓或未完成：

- 安装前本地前置依赖检测。
- GTA5 / GTA5 Enhanced 的 RPF 深层写入规则（当前隐藏）。
- aria2 任务快照和软件重启后的历史任务恢复。
- `.mmp` 子包选择、单个/多个 Mod 导出和包信息编辑。
- 非 Nexus 来源 Mod 更新识别。
- 完全无人值守 Mod 更新。
- Nexus OAuth 长期 Token 刷新。
- Playwright 界面冒烟测试。
- `App.vue` 组件拆分和进一步响应式优化。
