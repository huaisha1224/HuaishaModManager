<script setup lang="ts">
import { AlertCircle, ExternalLink, Info, LoaderCircle, PackageOpen } from "lucide-vue-next";
import { useLibraryStore } from "@/stores/library";

const library = useLibraryStore();

function openPan(url: string) {
  if (!url) return;
  void window.mayfly.openExternal(url);
}
</script>

<template>
  <div class="bigModList">
    <div class="bigModNotice bigModNotice--info">
      <Info :size="14" />
      <span>大型 mod 列表来自夸克网盘分享,点击"打开下载页面"会跳转外部浏览器。下载之后用导入模组功能选中压缩包导入即可。</span>
    </div>

    <div v-if="library.bigModLoading" class="bigModState">
      <LoaderCircle :size="32" class="spin" />
      <p>正在加载模组整合包列表...</p>
    </div>

    <div v-else-if="library.activeBigMods.length === 0" class="bigModState">
      <PackageOpen :size="32" />
      <p>当前游戏暂无模组整合包</p>
      <small>该游戏不在整合包收录范围,或数据源为空。</small>
    </div>

    <div v-else class="bigModGrid">
      <article v-for="mod in library.activeBigMods" :key="mod.id" class="bigModCard">
        <div class="bigModInfo">
          <h3 class="bigModName" :title="mod.name">{{ mod.name }}</h3>
          <div class="bigModMeta">
            <span class="bigModTag">作者: {{ mod.author || "未知" }}</span>
            <span class="bigModTag">大小: {{ mod.size || "未知" }}</span>
            <span v-if="mod.nexusId" class="bigModTag">Nexus ID: {{ mod.nexusId }}</span>
          </div>
          <p class="bigModDesc">{{ mod.description || "(无描述)" }}</p>
        </div>
        <div class="bigModActions">
          <button
            class="primary"
            :disabled="!mod.panUrl"
            @click="openPan(mod.panUrl)"
            :title="mod.panUrl"
          >
            <ExternalLink :size="14" />
            打开下载页面
          </button>
        </div>
      </article>
    </div>

    <div
      v-if="library.bigModError && !library.bigModLoading"
      class="bigModNotice bigModNotice--error"
    >
      <AlertCircle :size="16" />
      <span>{{ library.bigModError }}</span>
      <button class="retryBtn" @click="library.refreshBigMods()">重试</button>
    </div>
  </div>
</template>

<style scoped>
.bigModList {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  height: 100%;
  overflow-y: auto;
}
.bigModNotice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  border: 1px solid transparent;
  flex-wrap: wrap;
}
.bigModNotice--info {
  background: rgba(102, 192, 244, 0.10);
  color: var(--c-accent);
  border-color: rgba(102, 192, 244, 0.25);
}
.bigModNotice--error {
  background: rgba(255, 90, 90, 0.12);
  color: var(--c-danger);
  border-color: rgba(255, 90, 90, 0.3);
}
.retryBtn {
  margin-left: auto;
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;
}
.bigModState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--c-text-secondary);
  gap: 8px;
}
.spin {
  animation: spin 1s linear infinite;
  color: var(--c-accent);
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.bigModGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.bigModCard {
  display: flex;
  flex-direction: column;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
  transition: all 0.18s ease;
}
.bigModCard:hover {
  border-color: rgba(102, 192, 244, 0.4);
  background: rgba(255, 255, 255, 0.05);
}
.bigModInfo {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.bigModName {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--c-text-strong);
  word-break: break-word;
}
.bigModDesc {
  margin: 0;
  font-size: 12px;
  color: var(--c-text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}
.bigModMeta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.bigModTag {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  color: var(--c-text-secondary);
  white-space: nowrap;
}
.bigModActions {
  padding: 10px 14px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
.bigModActions .primary {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 13px;
  border-radius: 6px;
  border: 1px solid var(--c-accent);
  background: var(--c-accent);
  color: var(--c-text-on-accent);
  cursor: pointer;
  transition: all 0.15s ease;
}
.bigModActions .primary:hover:not(:disabled) {
  background: var(--c-accent-hover);
  border-color: var(--c-accent-hover);
}
.bigModActions .primary:disabled {
  background: var(--c-accent)44;
  border-color: var(--c-accent)44;
  cursor: not-allowed;
}
</style>
