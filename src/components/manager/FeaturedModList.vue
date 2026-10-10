<!--
  HGMM 精选 mod 列表(Phase 1B)

  数据源:store.featuredMods(由 library.loadFeaturedMods() 从 CDN 拉取归一化)
  行为:
    - 默认 manager tab 内的 sub-tab 显示
    - 用户点击"一键下载"→ library.installFeaturedMod(mod)
    - 互斥分组(groupId)标记后,同组其他 mod 禁用按钮
    - Phase 1B 简化:只下载,不自动 install
    - Phase 2 接入 InstallStrategy.preSteps 后启用 Delete 规则
-->
<script setup lang="ts">
import {
  AlertCircle,
  Check,
  Download,
  Info,
  Layers,
  LoaderCircle,
  Search,
  SearchX,
  Sparkles,
  X
} from "lucide-vue-next";
import { computed, ref } from "vue";
import { useLibraryStore } from "@/stores/library";

const library = useLibraryStore();

/** HGMM 精选 mod 搜索(Phase 5):多关键词 AND 模糊匹配 name/description/modType */
const searchQuery = ref("");

/** 描述浮窗 hover 状态(BUG-007):单 ref 控制只显示一个浮窗,避免密集触发 */
const hoveredDescId = ref<string | null>(null);

const filteredMods = computed(() => {
  const keywords = searchQuery.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return library.featuredMods;
  return library.featuredMods.filter((mod) => {
    const haystack = [mod.name, mod.description, mod.modType]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return keywords.every((kw) => haystack.includes(kw));
  });
});

function modTypeLabel(modType: string): string {
  switch (modType) {
    case "pak":
      return "pak mod (~mods)";
    case "logicMods":
      return "pak mod (LogicMods)";
    case "ue4ss":
      return "UE4SS 加载器";
    case "mods":
      return "UE4SS mods";
    case "scripts":
      return "UE4SS scripts";
    case "bepinex":
      return "BepInEx 加载器";
    case "plugins":
      return "BepInEx plugin";
    case "absolute":
      return "绝对路径";
    case "root":
      return "游戏根目录";
    case "unknown":
      return "未知";
    default:
      return modType;
  }
}

function modTypeColor(modType: string): string {
  switch (modType) {
    case "pak":
      return "var(--c-accent)";
    case "logicMods":
      return "var(--c-accent-hover)";
    case "ue4ss":
      return "var(--c-success)";
    case "mods":
      return "var(--c-success)";
    case "scripts":
      return "var(--c-success)";
    case "bepinex":
      return "var(--c-warning)";
    case "plugins":
      return "var(--c-warning)";
    case "absolute":
      return "var(--c-danger)";
    case "root":
      return "var(--c-special-purple)";
    case "unknown":
      return "var(--c-text-secondary)";
    default:
      return "var(--c-text-secondary)";
  }
}
</script>

<template>
  <div class="featuredModList">
    <!-- 灰度关闭警告 -->
    <div
      v-if="library.featuredGlobalEnabled === false"
      class="featuredNotice featuredNotice--warn"
    >
      <AlertCircle :size="16" />
      <span>当前游戏精选 mod 已被官方灰度关闭,本批数据仅供浏览。</span>
    </div>

    <!-- Delete 清理规则提示 -->
    <div
      v-if="library.featuredDeleteRules.length > 0"
      class="featuredNotice featuredNotice--info"
    >
      <Info :size="14" />
      <span>
        本批 mod 含 {{ library.featuredDeleteRules.length }} 条清理规则,Phase 1B 仅展示,不自动执行。
      </span>
    </div>

    <!-- 加载中 -->
    <div v-if="library.featuredLoading" class="featuredState">
      <LoaderCircle :size="32" class="spin" />
      <p>正在从 HGMM CDN 拉取精选 mod...</p>
    </div>

    <!-- 空态:游戏不在 7 款精选范围,或 CDN 无数据 -->
    <div v-else-if="library.featuredMods.length === 0" class="featuredState">
      <Sparkles :size="32" />
      <p>当前游戏暂无精选 mod</p>
      <small>该游戏不在 HGMM 7 款精选游戏范围,或 CDN 配置为空。</small>
    </div>

    <!-- 有 mod:显示搜索框 + 列表(或搜索无匹配) -->
    <template v-else>
      <div class="featuredSearchBar">
        <Search :size="14" class="featuredSearchIcon" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索名称 / 描述 / 类型,空格分隔多关键词"
          class="featuredSearchInput"
        />
        <button
          v-if="searchQuery"
          class="featuredSearchClear"
          title="清空搜索"
          @click="searchQuery = ''"
        >
          <X :size="14" />
        </button>
        <span class="featuredSearchCount">
          {{ filteredMods.length }} / {{ library.featuredMods.length }}
        </span>
      </div>

      <!-- 搜索无匹配 -->
      <div v-if="filteredMods.length === 0" class="featuredState">
        <SearchX :size="32" />
        <p>没有匹配 "{{ searchQuery }}" 的 mod</p>
        <small>尝试其他关键字,或清空搜索查看全部。</small>
      </div>

      <!-- 列表 -->
      <div v-else class="featuredGrid">
        <article
          v-for="mod in filteredMods"
          :key="mod.id"
          class="featuredCard"
          :class="{ disabled: library.featuredGroupDisabled(mod) }"
        >
        <div class="featuredCover">
          <img
            v-if="mod.coverUrl"
            :src="mod.coverUrl"
            :alt="mod.name"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <Sparkles v-else :size="40" />
        </div>

        <div class="featuredInfo">
          <h3 class="featuredName" :title="mod.name">{{ mod.name }}</h3>
          <div
            class="featuredDescWrap"
            @mouseenter="hoveredDescId = mod.id"
            @mouseleave="hoveredDescId = null"
          >
            <p class="featuredDesc">
              {{ mod.description || "(无描述)" }}
            </p>
            <div v-if="hoveredDescId === mod.id" class="featuredDescPopover">
              <p class="featuredDescPopoverText">{{ mod.description }}</p>
            </div>
          </div>

          <div class="featuredMeta">
            <span
              class="featuredTag"
              :style="{ background: modTypeColor(mod.modType) }"
            >
              {{ modTypeLabel(mod.modType) }}
            </span>

            <span
              v-if="library.isInstalledByOrigin('featured', mod.id)"
              class="featuredInstalledBadge"
              title="已安装:请到「已安装 mod」页面卸载"
            >
              <Check :size="11" />
              <span>已安装</span>
            </span>

            <!-- 2026-09-22 隐藏:手动"标记互斥"功能已废弃,改成自动按已安装 mod 处理(BUG-006)
            <span
              v-if="mod.groupId && mod.groupId > 0"
              class="featuredGroup"
              :class="{ active: library.featuredActiveGroupIds.has(mod.groupId) }"
            >
              <Layers :size="12" />
              <span>互斥组 {{ mod.groupId }}</span>
              <button
                v-if="library.featuredActiveGroupIds.has(mod.groupId)"
                class="groupUnbind"
                title="解除互斥标记"
                @click="library.toggleFeaturedGroup(mod.groupId!)"
              >
                <X :size="12" />
              </button>
            </span>
            -->
          </div>

          <small class="featuredPath" :title="mod.installPath">
            路径: {{ mod.installPath }}
          </small>
        </div>

        <div class="featuredActions">
          <button
            class="primary"
            :class="{ isInstalled: library.isInstalledByOrigin('featured', mod.id) }"
            :disabled="library.featuredGroupDisabled(mod) || library.installingFeaturedId === mod.id || library.isInstalledByOrigin('featured', mod.id)"
            @click="library.installFeaturedMod(mod)"
          >
            <LoaderCircle
              v-if="library.installingFeaturedId === mod.id"
              :size="16"
              class="spin"
            />
            <Check
              v-else-if="library.isInstalledByOrigin('featured', mod.id)"
              :size="16"
            />
            <Download v-else :size="16" />
            <span>
              <template v-if="library.installingFeaturedId === mod.id">安装中...</template>
              <template v-else-if="library.isInstalledByOrigin('featured', mod.id)">已安装</template>
              <template v-else-if="mod.modType === 'absolute'">下载并提示</template>
              <template v-else>一键安装</template>
            </span>
          </button>

          <!-- 2026-09-22 隐藏:手动"标记互斥"功能已废弃(BUG-006)
          <button
            v-if="mod.groupId && mod.groupId > 0 && !library.featuredActiveGroupIds.has(mod.groupId)"
            class="secondary"
            title="标记此 mod 为当前互斥组的激活项"
            @click="library.toggleFeaturedGroup(mod.groupId!)"
          >
            <Layers :size="14" />
            标记互斥
          </button>
          -->
        </div>
      </article>
    </div>
    </template>

    <!-- Delete 规则详情 -->
    <details
      v-if="library.featuredDeleteRules.length > 0"
      class="featuredDeleteDetails"
    >
      <summary>清理规则详情({{ library.featuredDeleteRules.length }})</summary>
      <ul>
        <li v-for="(rule, i) in library.featuredDeleteRules" :key="i">
          <code>{{ rule.Directory }}</code>
          <span v-if="rule.Description"> — {{ rule.Description }}</span>
          <span class="featuredDeleteType">[type {{ rule.type }}]</span>
        </li>
      </ul>
      <p class="featuredDeleteNote">
        ⚠️ Phase 1B 暂不自动执行清理。Phase 2 接入 InstallStrategy.preSteps 后,在 applyModStrategy 之前自动调用。
      </p>
    </details>

    <!-- 错误(非加载中时显示) -->
    <div
      v-if="library.error && !library.featuredLoading"
      class="featuredNotice featuredNotice--error"
    >
      <AlertCircle :size="16" />
      <span>{{ library.error }}</span>
    </div>
  </div>
</template>

<style scoped>
.featuredModList {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}

/* 顶部通知条 */
.featuredNotice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid transparent;
}
.featuredNotice--warn {
  background: rgba(255, 142, 163, 0.12);
  color: var(--c-danger);
  border-color: rgba(255, 142, 163, 0.3);
}
.featuredNotice--info {
  background: rgba(102, 192, 244, 0.10);
  color: var(--c-accent);
  border-color: rgba(102, 192, 244, 0.25);
}
.featuredNotice--error {
  background: rgba(255, 90, 90, 0.12);
  color: var(--c-danger);
  border-color: rgba(255, 90, 90, 0.3);
}

/* 搜索框(Phase 5) */
.featuredSearchBar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  transition: border-color 0.15s ease;
}
.featuredSearchBar:focus-within {
  border-color: rgba(102, 192, 244, 0.5);
  background: rgba(255, 255, 255, 0.05);
}
.featuredSearchIcon {
  color: var(--c-text-secondary);
  flex-shrink: 0;
}
.featuredSearchInput {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--c-text-strong);
  font-size: 13px;
  padding: 2px 0;
  min-width: 0;
}
.featuredSearchInput::placeholder {
  color: var(--c-text-tertiary);
}
.featuredSearchClear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--c-text-secondary);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  flex-shrink: 0;
}
.featuredSearchClear:hover {
  color: var(--c-text-strong);
  background: rgba(255, 255, 255, 0.08);
}
.featuredSearchCount {
  font-size: 11px;
  color: var(--c-text-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 加载/空态 */
.featuredState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--c-text-secondary);
  gap: 8px;
}
.featuredState p {
  margin: 0;
  font-size: 14px;
}
.featuredState small {
  font-size: 12px;
  opacity: 0.75;
}
.spin {
  animation: spin 1s linear infinite;
  color: var(--c-accent);
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 网格 */
.featuredGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.featuredCard {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  /* BUG-007:overflow 改 visible 由 issue 推动(原 hidden 会裁掉描述浮窗),子元素自行处理圆角 */
  overflow: visible;
  transition: all 0.18s ease;
}
.featuredCard:hover {
  border-color: rgba(102, 192, 244, 0.4);
  background: rgba(255, 255, 255, 0.05);
}
.featuredCard.disabled {
  opacity: 0.45;
  pointer-events: none;
}

.featuredCover {
  height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, rgba(102, 192, 244, 0.15), rgba(101, 214, 173, 0.12));
  color: rgba(255, 255, 255, 0.4);
  /* BUG-007:覆盖图自身负责顶部圆角(因 .featuredCard 已改 overflow:visible) */
  border-radius: 10px 10px 0 0;
  overflow: hidden;
}
.featuredCover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.featuredInfo {
  padding: 12px 14px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}
.featuredName {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.featuredDesc {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-secondary);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* BUG-007:描述浮窗容器(原 :title 改成自实现 hover popover) */
.featuredDescWrap {
  position: relative;
  display: block;
}

.featuredDescPopover {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 50;
  min-width: 100%;
  max-width: 380px;
  padding: 10px 12px;
  background: var(--c-bg-elevated);
  border: 1px solid var(--c-border-strong);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.featuredDescPopoverText {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-strong);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.featuredMeta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.featuredTag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--c-text-on-accent);
  font-weight: 500;
}
.featuredGroup {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(245, 184, 92, 0.15);
  color: var(--c-warning);
  border: 1px solid rgba(245, 184, 92, 0.3);
}
.featuredGroup.active {
  background: rgba(245, 184, 92, 0.35);
  border-color: rgba(245, 184, 92, 0.6);
}
.groupUnbind {
  display: inline-flex;
  align-items: center;
  background: transparent;
  border: none;
  cursor: pointer;
  color: inherit;
  padding: 0;
  margin-left: 2px;
}
.groupUnbind:hover {
  color: var(--c-text-on-accent);
}

/* 怀沙:已安装 badge */
.featuredInstalledBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(101, 214, 173, 0.18);
  color: var(--c-success);
  border: 1px solid rgba(101, 214, 173, 0.4);
}

.featuredPath {
  font-size: 11px;
  color: var(--c-text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.featuredActions {
  display: flex;
  gap: 6px;
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.featuredActions button {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}
.featuredActions .primary {
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  border-color: var(--c-accent);
}
.featuredActions .primary:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}
.featuredActions .primary:disabled,
.featuredActions .primary.isInstalled {
  background: rgba(101, 214, 173, 0.18);
  border-color: rgba(101, 214, 173, 0.4);
  color: var(--c-success);
  cursor: not-allowed;
}
.featuredActions .secondary {
  background: transparent;
  color: var(--c-warning);
  border-color: rgba(245, 184, 92, 0.4);
  flex: 0 0 auto;
}
.featuredActions .secondary:hover {
  background: rgba(245, 184, 92, 0.1);
}

/* Delete 规则详情 */
.featuredDeleteDetails {
  margin-top: 8px;
  padding: 12px 14px;
  background: rgba(255, 142, 163, 0.06);
  border: 1px solid rgba(255, 142, 163, 0.2);
  border-radius: 8px;
  color: var(--c-text-secondary);
  font-size: 12px;
}
.featuredDeleteDetails summary {
  cursor: pointer;
  font-weight: 500;
  color: var(--c-danger);
  user-select: none;
}
.featuredDeleteDetails ul {
  margin: 8px 0 0;
  padding-left: 20px;
}
.featuredDeleteDetails code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(0, 0, 0, 0.3);
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--c-text-strong);
}
.featuredDeleteType {
  font-size: 10px;
  color: var(--c-text-tertiary);
  margin-left: 4px;
}
.featuredDeleteNote {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--c-text-secondary);
}
</style>