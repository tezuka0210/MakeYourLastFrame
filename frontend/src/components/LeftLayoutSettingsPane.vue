<template>
  <div class="container">
    <section class="settings-card">
      <header class="settings-header">
        <h2 class="header-title">Layout & Colors</h2>
      </header>

      <div class="settings-content">
        <!-- Layout: Horizontal Spacing -->
        <div class="form-group">
          <label class="form-label">Horizontal Spacing</label>
          <div class="layout-control">
            <input
              type="range"
              min="40"
              max="320"
              step="10"
              v-model.number="horizontalGap"
              class="layout-slider"
            />
            <input
              type="number"
              min="40"
              max="320"
              step="10"
              v-model.number="horizontalGap"
              class="layout-input"
            />
          </div>
        </div>

        <!-- Layout: Vertical Spacing -->
        <div class="form-group">
          <label class="form-label">Vertical Spacing</label>
          <div class="layout-control">
            <input
              type="range"
              min="60"
              max="320"
              step="10"
              v-model.number="verticalGap"
              class="layout-slider"
            />
            <input
              type="number"
              min="60"
              max="320"
              step="10"
              v-model.number="verticalGap"
              class="layout-input"
            />
          </div>
        </div>

        <!-- Colors: Image Modality -->
        <div class="form-group form-group-inline color-row-first">
          <span class="form-label-inline">Image Modality Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="imageColor"
              class="color-input"
            />
            <span class="color-hex">{{ imageColor }}</span>
          </div>
        </div>

        <!-- Colors: Video Modality -->
        <div class="form-group form-group-inline">
          <span class="form-label-inline">Video Modality Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="videoColor"
              class="color-input"
            />
            <span class="color-hex">{{ videoColor }}</span>
          </div>
        </div>

        <!-- Colors: Audio Modality -->
        <div class="form-group form-group-inline">
          <span class="form-label-inline">Audio Modality Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="audioColor"
              class="color-input"
            />
            <span class="color-hex">{{ audioColor }}</span>
          </div>
        </div>

        <!-- Colors: Overlap State -->
        <div class="form-group form-group-inline">
          <span class="form-label-inline">Overlap State Color</span>
          <div class="color-control">
            <input
              type="color"
              v-model="overlapColor"
              class="color-input"
            />
            <span class="color-hex">{{ overlapColor }}</span>
          </div>
        </div>
      </div>

      <div class="settings-footer">
        <button class="apply-btn" @click="applySettings">
          Apply Layout & Colors
        </button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  (e: 'apply-layout-settings', payload: {
    horizontalGap: number
    verticalGap: number
    colors: { image: string; video: string; audio: string; overlap: string }
  }): void
}>()

// 默认值与当前 dagre 设置保持一致（nodesep=100, ranksep=120）
const horizontalGap = ref(100)
const verticalGap = ref(120)

// 从全局 CSS 变量里读默认颜色（与你 style.css 里的 :root 保持一致）
const imageColor = ref('#5F96DB')
const videoColor = ref('#5ABF8E')
const audioColor = ref('#E06C6E')
const overlapColor = ref('#7385A9')

onMounted(() => {
  const rootStyle = getComputedStyle(document.documentElement)

  const img = rootStyle.getPropertyValue('--media-image').trim()
  const vid = rootStyle.getPropertyValue('--media-video').trim()
  const aud = rootStyle.getPropertyValue('--media-audio').trim()
  const ovl = rootStyle.getPropertyValue('--media-overlap').trim()

  if (img) imageColor.value = normalizeColor(img)
  if (vid) videoColor.value = normalizeColor(vid)
  if (aud) audioColor.value = normalizeColor(aud)
  if (ovl) overlapColor.value = normalizeColor(ovl)
})

function normalizeColor(value: string): string {
  const trimmed = value.trim()
  // 现在你的 CSS 就是 #xxxxxx，直接返回即可
  if (trimmed.startsWith('#')) return trimmed
  return trimmed
}

/**
 * 简单 soft 颜色生成：把颜色往白色拉近（factor 越大越浅）
 * 比如 factor=0.5 表示往 #ffffff 走一半
 */
function makeSoftColor(hex: string, factor = 0.5): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex // 非法就原样返回

  const raw = m[1]
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)

  const mixChannel = (c: number) =>
    Math.round(c + (255 - c) * factor)

  const nr = mixChannel(r)
  const ng = mixChannel(g)
  const nb = mixChannel(b)

  const toHex = (c: number) => c.toString(16).padStart(2, '0')

  return '#' + toHex(nr) + toHex(ng) + toHex(nb)
}

const applySettings = () => {
  // 1) 基础颜色写入 CSS 变量
  document.documentElement.style.setProperty('--media-image', imageColor.value)
  document.documentElement.style.setProperty('--media-video', videoColor.value)
  document.documentElement.style.setProperty('--media-audio', audioColor.value)
  document.documentElement.style.setProperty('--media-overlap', overlapColor.value)

  // 2) soft 颜色写入 CSS 变量（给卡片标题、渐变、背景用）
  const imageSoft = makeSoftColor(imageColor.value, 0.45)
  const videoSoft = makeSoftColor(videoColor.value, 0.45)
  const audioSoft = makeSoftColor(audioColor.value, 0.45)
  const overlapSoft = makeSoftColor(overlapColor.value, 0.45)

  document.documentElement.style.setProperty('--media-image-soft', imageSoft)
  document.documentElement.style.setProperty('--media-video-soft', videoSoft)
  document.documentElement.style.setProperty('--media-audio-soft', audioSoft)
  document.documentElement.style.setProperty('--media-overlap-soft', overlapSoft)

  // 3) 通过 window 事件广播布局 & 颜色更新（WorkflowTree.vue 监听）
  window.dispatchEvent(
    new CustomEvent('t2v-layout-updated', {
      detail: {
        horizontalGap: horizontalGap.value,
        verticalGap: verticalGap.value,
        colors: {
          image: imageColor.value,
          video: videoColor.value,
          audio: audioColor.value,
          overlap: overlapColor.value,
        },
      },
    }),
  )

  // 4) 同时通过 emit 暴露给父组件（如果你那边有用）
  emit('apply-layout-settings', {
    horizontalGap: horizontalGap.value,
    verticalGap: verticalGap.value,
    colors: {
      image: imageColor.value,
      video: videoColor.value,
      audio: audioColor.value,
          overlap: overlapColor.value,
    },
  })
}
</script>


<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: Inter, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif;
}

.container {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.settings-card {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f7f7f8;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  overflow: hidden;
}

.settings-header {
  padding: 12px 12px 10px;
  border-bottom: 1px solid #eceef1;
  background: #f7f7f8;
}

.header-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #6b7280;
}

.settings-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: transparent;
}

.settings-content::-webkit-scrollbar-thumb {
  background: #d2d7de;
  border-radius: 999px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
}

.form-group-inline {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.form-label,
.form-label-inline {
  font-size: 12px;
  font-weight: 600;
  color: #4b5563;
  line-height: 1.35;
}

.layout-control {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 58px;
  gap: 10px;
  align-items: center;
}

.layout-slider {
  width: 100%;
  accent-color: #8f96a3;
  cursor: pointer;
}

.layout-input {
  width: 100%;
  height: 28px;
  border: 1px solid #d6dbe2;
  border-radius: 10px;
  background: #ffffff;
  color: #4b5563;
  font-size: 11px;
  font-weight: 700;
  text-align: center;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.layout-input:focus {
  border-color: #c7cdd6;
  box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12);
}

.color-control {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.color-input {
  width: 32px;
  height: 22px;
  padding: 2px;
  border: 1px solid #d4d9e1;
  border-radius: 8px;
  background: #ffffff;
  cursor: pointer;
  overflow: hidden;
}

.color-hex {
  min-width: 72px;
  font-size: 11px;
  font-weight: 600;
  color: #7b8798;
  text-align: right;
}

.settings-footer {
  padding: 10px 12px 12px;
  border-top: 1px solid #eceef1;
  background: #f7f7f8;
}

.apply-btn {
  width: 100%;
  min-height: 32px;
  border: 1px solid #cfd5dd;
  border-radius: 10px;
  background: #f1f3f5;
  color: #4b5563;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.apply-btn:hover {
  background: #ffffff;
  border-color: #c4ccd6;
}

.apply-btn:active {
  transform: scale(0.99);
}
</style>