<script setup lang="ts">
import { computed, ref } from "vue";
import {
  Archive,
  ArrowDownToLine,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Languages,
  LoaderCircle,
  Search
} from "lucide-vue-next";
import { useLibraryStore } from "@/stores/library";
import type { NexusModFile } from "@/types/domain";

const library = useLibraryStore();

// 详情视图本地状态(原 App.vue 内 selectedNexusImageIndex 等)
const selectedNexusImageIndex = ref(0);
const previewImage = ref({ visible: false, url: "", title: "" });

// 简易 toast(原 App.vue showToast,组件内独立)
const toastMessage = ref("");
let toastTimer: number | undefined;
function showToast(message: string, duration = 2600) {
  toastMessage.value = message;
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
  }
  toastTimer = window.setTimeout(() => {
    toastMessage.value = "";
    toastTimer = undefined;
  }, duration);
}

// 当前 Nexus 是否已有游戏选择(用于 search 守卫,替代删掉的 nexusGames)
const hasNexusPreset = computed(() => Boolean(library.nexusPresetId));

/** HGMM 客户端模糊兜底:
 *  服务端 nameStemmed + MATCHES 已做词干化/大小写不敏感,
 *  客户端再过滤一次以兼容"按 summary/author 搜不到、按 name 大小写变体搜不到"等边缘场景 */
const filteredNexusMods = computed(() => {
  const keywords = (library.nexusSearch ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return library.nexusMods;
  return library.nexusMods.filter((mod) => {
    const haystack = [mod.title, mod.summary, mod.author].filter(Boolean).join(" ").toLowerCase();
    return keywords.every((kw) => haystack.includes(kw));
  });
});

async function searchNexusMods() {
  if (!hasNexusPreset.value) {
    library.setError("请先在左侧选择已经添加过的 Nexus 游戏。");
    return;
  }

  library.nexusPage = 1;
  await library.loadNexusMods(1);
}

async function nextNexusPage(step: number, append = false) {
  const nextPage = Math.max(
    1,
    Math.min(library.nexusTotalPages || 1, library.nexusPage + step)
  );
  if (nextPage === library.nexusPage && !append) return;
  await library.loadNexusMods(nextPage, append);
}

// 怀沙:按 file.id 查下载队列状态,用于按钮态切换(spinner / "下载中" / 禁用)
function isDownloading(fileId: string) {
  const gameId = library.nexusPresetId ? `nexus:${library.nexusPresetId}` : "";
  if (!gameId) return false;
  return library.downloads.some((task) =>
    task.gameId === gameId &&
    task.source === "NexusMods" &&
    task.fileId === fileId &&
    (task.status === "queued" || task.status === "downloading")
  );
}

// 怀沙:统一处理下载点击 — 显示准确状态、避免重复点击
async function handleDownload(file: NexusModFile) {
  if (isDownloading(file.id)) {
    showToast(`"${file.name}" 已在下载队列中,请勿重复点击`);
    return;
  }
  showToast(`正在准备下载:${file.name}`);
  try {
    await library.downloadNexusFile(file);
    // 完成 / 失败由 task status / toast 反馈
  } catch (caught) {
    showToast(caught instanceof Error ? caught.message : "下载失败");
  }
}

function formatBytes(size: number) {
  if (!size) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string | number) {
  if (!value) return "未知时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("zh-CN");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeNexusHtml(html: string) {
  if (!html) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, form").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on") || value.startsWith("javascript:")) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return doc.body.innerHTML;
}

function safeLink(url: string) {
  const normalized = url.replace(/&amp;/g, "&").trim();
  return /^https?:\/\//i.test(normalized) ? escapeHtml(normalized) : "";
}

function renderNexusBbCode(value: string) {
  let html = escapeHtml(value)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br />")
    .replace(/&lt;\/?(?:p|div)&gt;/gi, "<br />")
    .replace(/\[\/?(?:size|font|center|left|right|color|quote)(?:=[^\]]*)?\]/gi, "")
    .replace(/\[(?:br|hr)\s*\/?\]/gi, "<br />")
    .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>")
    .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>")
    .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '<span class="bbUnderline">$1</span>')
    .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, (_match, url: string) => {
      const href = safeLink(url);
      return href ? `<img src="${href}" alt="" />` : "";
    })
    .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, (_match, url: string, label: string) => {
      const href = safeLink(url);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : label;
    })
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_match, url: string) => {
      const href = safeLink(url);
      return href ? `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>` : url;
    })
    .replace(/\[\*\]/g, "<br />• ")
    .replace(/\[\/?list(?:=[^\]]*)?\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\n/g, "<br />");

  html = html.replace(/(?:<br \/>){3,}/g, "<br /><br />");
  return sanitizeNexusHtml(html);
}

function renderNexusDescription(value: string, format: string) {
  if (!value) return "暂无说明。";
  return /\[[a-z*]+(?:=[^\]]+)?\]/i.test(value)
    ? renderNexusBbCode(value)
    : sanitizeNexusHtml(format === "html" ? value : escapeHtml(value).replace(/\n/g, "<br />"));
}

function openPreviewImage(url: string, title: string) {
  if (!url) return;
  previewImage.value = { visible: true, url, title };
}
</script>

<template>
  <div class="nexusBrowse">
    <!-- Mod Details View -->
    <div v-if="library.selectedNexusMod" class="nexusDetailView managerContent">
      <div class="activeGameBar" style="margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid var(--c-bg-elevated);">
        <button class="secondary" @click="library.selectedNexusMod = null">
          ← 返回列表
        </button>
        <span style="font-size: 20px; font-weight: 300; color: var(--c-text-strong); margin-left: 12px;">{{ library.selectedNexusMod.title }}</span>
      </div>

      <div class="steamWorkshopHero">
        <div class="heroCarousel">
          <div
            class="heroMainImageWrapper"
            @click="library.selectedNexusMod.images.length > 0 ? openPreviewImage(library.selectedNexusMod.images[selectedNexusImageIndex]?.imageUrl || library.selectedNexusMod.images[selectedNexusImageIndex]?.thumbnailUrl, library.selectedNexusMod.images[selectedNexusImageIndex]?.title) : null"
          >
            <img
              v-if="library.selectedNexusMod.images.length > 0"
              :src="library.selectedNexusMod.images[selectedNexusImageIndex]?.imageUrl || library.selectedNexusMod.images[selectedNexusImageIndex]?.thumbnailUrl"
              alt=""
              class="heroMainImage"
            />
            <img v-else-if="library.selectedNexusMod.cover" :src="library.selectedNexusMod.cover" alt="" class="heroMainImage" />
            <div v-else class="noCover"><Archive :size="64" /></div>
          </div>

          <div class="heroThumbnails" v-if="library.selectedNexusMod.images.length > 1">
            <button
              v-for="(img, idx) in library.selectedNexusMod.images"
              :key="img.id"
              class="heroThumb"
              :class="{ active: selectedNexusImageIndex === idx }"
              @click="selectedNexusImageIndex = idx"
            >
              <img :src="img.thumbnailUrl || img.imageUrl" />
            </button>
          </div>
        </div>

        <div class="heroSidebar">
          <div class="sidebarPanel">
            <h3>Mod 信息</h3>
            <div class="metaRow"><span>作者</span><strong>{{ library.selectedNexusMod.author || '未知' }}</strong></div>
            <div class="metaRow"><span>版本</span><strong>{{ library.selectedNexusMod.version || '无' }}</strong></div>
            <div class="metaRow"><span>更新</span><strong>{{ formatDate(library.selectedNexusMod.updatedAt).split(' ')[0] }}</strong></div>
            <div class="metaRow"><span>下载</span><strong>{{ (library.selectedNexusMod.downloads || 0).toLocaleString() }}</strong></div>
            <div class="metaRow"><span>点赞</span><strong>{{ (library.selectedNexusMod.likes || 0).toLocaleString() }}</strong></div>
          </div>

          <div class="sidebarPanel" v-if="library.selectedNexusMod.categories.length > 0">
            <h3>分类标签</h3>
            <div class="nexusCategoryRow" style="margin-top: 12px;">
              <span v-for="category in library.selectedNexusMod.categories" :key="category">{{ category }}</span>
            </div>
          </div>

          <div class="sidebarActions">
            <button class="secondary" @click="library.openNexusUrl(library.selectedNexusMod.website)" style="width: 100%; justify-content: center;">打开 Nexus 页面</button>
            <button
              class="secondary"
              :disabled="library.nexusTranslationLoading"
              @click="showToast('敬请期待')"
              style="width: 100%; justify-content: center; margin-top: 8px;"
            >
              <LoaderCircle v-if="library.nexusTranslationLoading" :size="16" class="spin" />
              <Languages v-else :size="16" />
              {{ library.nexusTranslationVisible ? "刷新翻译" : "翻译成中文" }}
            </button>
            <button v-if="library.nexusTranslationVisible" class="secondary" @click="library.showOriginalNexusText" style="width: 100%; justify-content: center; margin-top: 8px;">查看原文</button>
          </div>

          <p v-if="library.nexusTranslationError" class="translationError" style="margin-top: 12px;">
            {{ library.nexusTranslationError }}
          </p>
        </div>
      </div>

      <div class="nexusDetailColumns" style="margin-top: 32px; gap: 32px;">
        <section class="nexusDescriptionBlock" style="flex: 2; min-width: 0;">
          <h3 style="font-size: 18px; border-bottom: 1px solid var(--c-bg-elevated); padding-bottom: 8px; margin-bottom: 16px;">说明</h3>
          <div style="font-size: 14px; color: var(--c-text-secondary); line-height: 1.6; padding: 12px; background: rgba(0,0,0,0.2); border-left: 3px solid var(--c-info); margin-bottom: 24px;">
            {{ library.nexusTranslationVisible && library.nexusTranslatedSummary ? library.nexusTranslatedSummary : library.selectedNexusMod.summary || "无摘要" }}
          </div>
          <div
            v-if="library.nexusTranslationVisible && library.nexusTranslatedDescription"
            class="nexusDescription translatedText"
            v-html="renderNexusDescription(library.nexusTranslatedDescription, library.selectedNexusMod.descriptionFormat)"
          />
          <div
            v-else
            class="nexusDescription"
            v-html="renderNexusDescription(library.selectedNexusMod.description, library.selectedNexusMod.descriptionFormat)"
          />
        </section>

        <section class="nexusFilesBlock" style="flex: 1;">
          <h3 style="font-size: 18px; border-bottom: 1px solid var(--c-bg-elevated); padding-bottom: 8px; margin-bottom: 16px;">文件</h3>
          <div v-if="library.selectedNexusMod.files.length === 0" class="empty">
            Nexus 没返回可下载文件。
          </div>
          <article v-for="file in library.selectedNexusMod.files" :key="file.id" class="fileRow">
            <div>
              <strong>{{ file.name }}</strong>
              <span>
                {{ file.categoryName || "文件" }}
                · {{ file.version || "无版本" }}
                · {{ formatBytes(file.size) }}
                · {{ formatDate(file.createdAt) }}
              </span>
            </div>
            <div class="compactActions">
              <span
                v-if="library.isInstalledByOrigin('nexus', library.selectedNexusMod.id, file.id)"
                class="nexusFileInstalledBadge"
                title="已安装:请到「已安装 mod」页面卸载"
              >
                <Check :size="11" />
                <span>已装</span>
              </span>
              <button class="secondary" @click="library.openNexusUrl(file.detailsUrl)">网页</button>
              <button
                class="primary"
                :class="{ isInstalled: library.isInstalledByOrigin('nexus', library.selectedNexusMod.id, file.id) }"
                :disabled="library.busy || isDownloading(file.id) || library.isInstalledByOrigin('nexus', library.selectedNexusMod.id, file.id)"
                @click="handleDownload(file)"
              >
                <LoaderCircle v-if="isDownloading(file.id)" :size="16" class="spin" />
                <Check
                  v-else-if="library.isInstalledByOrigin('nexus', library.selectedNexusMod.id, file.id)"
                  :size="16"
                />
                <ArrowDownToLine v-else :size="16" />
                {{ isDownloading(file.id) ? "下载中" : library.isInstalledByOrigin('nexus', library.selectedNexusMod.id, file.id) ? "已装" : "下载" }}
              </button>
            </div>
          </article>
        </section>
      </div>
    </div>

    <!-- Mod List View -->
    <div v-else class="nexusListView managerContent" style="gap: 18px;">
      <div class="steamFilterBar">
        <div class="steamFilterLeft">
          <div class="steamSearchBox">
            <input v-model="library.nexusSearch" placeholder="搜索 Mod..." @keyup.enter="searchNexusMods" />
            <button class="searchBtn" @click="searchNexusMods" title="搜索">
              <Search :size="14" />
            </button>
          </div>

          <div class="steamDropdown">
            <select v-model="library.nexusCategory" @change="searchNexusMods">
              <option value="">全部分类</option>
              <option v-for="facet in library.nexusFacets.categoryName" :key="facet.value" :value="facet.value">
                {{ facet.label }} ({{ facet.count }})
              </option>
            </select>
            <ChevronDown :size="12" class="chevron" />
          </div>
        </div>

        <div class="steamFilterRight">
          <div class="steamDropdown">
            <span class="label">排序方式:</span>
            <select v-model="library.nexusSort" @change="searchNexusMods">
              <option value="downloads">下载最多</option>
              <option value="updatedAt">最近更新</option>
              <option value="createdAt">最新发布</option>
              <option value="default">默认</option>
            </select>
            <ChevronDown :size="12" class="chevron" />
          </div>
        </div>
      </div>

      <div v-if="library.nexusLoading && library.nexusMods.length === 0" class="steamLoadingCenter">
        <LoaderCircle :size="32" class="spin" />
        <p>正在拉取 NexusMods...</p>
      </div>
      <div v-else-if="filteredNexusMods.length === 0" class="steamLoadingCenter" style="min-height: 400px; flex-direction: column;">
        <Search :size="48" style="color: var(--c-text-tertiary); margin-bottom: 16px;" />
        <h3 style="color: var(--c-text-secondary); margin: 0 0 8px; font-weight: normal;">没有任何结果</h3>
        <p style="color: var(--c-text-tertiary); margin: 0; font-size: 13px;">没有找到匹配的 Mod。尝试清空搜索词或放宽过滤条件。</p>
      </div>

      <div v-else class="steamCardsGrid horizontalGrid" :class="{ 'is-loading': library.nexusLoading }">
        <div v-if="library.nexusLoading" class="gridLoadingOverlay">
          <div class="loadingSpinnerWrapper">
            <LoaderCircle :size="32" class="spin" />
          </div>
        </div>
        <article
          v-for="item in filteredNexusMods"
          :key="item.id"
          class="steamCard horizontalCard"
          @click="library.openNexusModDetail(item); selectedNexusImageIndex = 0;"
        >
          <div class="cardCover">
            <img v-if="item.cover" :src="item.cover" alt="" />
            <div v-else class="noCover"><Archive :size="32" /></div>
            <div class="cardHover">
              <span>查看详情</span>
            </div>
          </div>
          <div class="cardInfoHorizontal" style="flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 12px; height: 60px;">
            <div class="cardInfoTitle" style="width: 100%;">
              <h3 :title="item.title" style="flex: 1; font-size: 14px; margin-bottom: 2px;">{{ item.title || `Mod ${item.id}` }}</h3>
            </div>
            <div style="display: flex; gap: 16px; font-size: 11px; color: var(--c-text-secondary); width: 100%; align-items: center;">
              <span title="下载量"><Download :size="11" style="vertical-align: -2px; margin-right: 4px;"/>{{ (item.downloads || 0).toLocaleString() }}</span>
              <span title="更新日期"><Calendar :size="11" style="vertical-align: -2px; margin-right: 4px;"/>{{ formatDate(item.updatedAt).split(' ')[0] }}</span>
              <span
                v-if="library.isInstalledByOrigin('nexus', item.id)"
                class="nexusInstalledBadge"
                title="已安装:请到「已安装 mod」页面卸载"
              >
                <Check :size="11" />
                <span>已装</span>
              </span>
            </div>
          </div>
        </article>
      </div>

      <div class="steamPaginationFloat" v-if="library.nexusMods.length > 0">
        <button class="secondary" :disabled="library.nexusPage <= 1 || library.nexusLoading" @click="nextNexusPage(-1)">
          <ChevronUp :size="16" />
        </button>
        <span>{{ library.nexusPage }} / {{ library.nexusTotalPages || 1 }}</span>
        <button class="secondary" :disabled="library.nexusPage >= (library.nexusTotalPages || 1) || library.nexusLoading" @click="nextNexusPage(1)">
          <ChevronDown :size="16" />
        </button>
      </div>
    </div>

    <!-- 本地 toast(组件内独立) -->
    <Transition name="toastFade">
      <div v-if="toastMessage" class="toastBar">{{ toastMessage }}</div>
    </Transition>

    <!-- 图片预览遮罩 -->
    <div v-if="previewImage.visible" class="imagePreviewMask" @click="previewImage.visible = false">
      <img :src="previewImage.url" :alt="previewImage.title" />
    </div>
  </div>
</template>

<style scoped>
.nexusBrowse {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow-y: auto;
}
.toastBar {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 14px 28px;
  background: rgba(20, 24, 30, 0.94);
  color: var(--c-text-strong);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  font-size: 18px;
  font-weight: 500;
  letter-spacing: 0.04em;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 999;
  pointer-events: none;
}
.toastFade-enter-active,
.toastFade-leave-active {
  transition: opacity 0.2s ease;
}
.toastFade-enter-from,
.toastFade-leave-to {
  opacity: 0;
}
.imagePreviewMask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 998;
  cursor: zoom-out;
}
/* 怀沙:已安装 badge */
.nexusInstalledBadge,
.nexusFileInstalledBadge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  background: rgba(101, 214, 173, 0.18);
  color: var(--c-success);
  border: 1px solid rgba(101, 214, 173, 0.4);
}

.imagePreviewMask img {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
}
</style>
