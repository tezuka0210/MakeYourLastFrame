<template>
  <div class="h-full min-h-0 box-border px-2 py-3">
    <div class="left-grid h-full min-h-0">
      <!-- 1) Sessions：吃剩余高度；内部内容可以滚动 -->
      <div class="min-h-0 pt-[4px]">
        <LeftSessionsPane class="h-full" />
      </div>

      <!-- 2) Global settings：固定高度（随屏幕 clamp） -->
      <!-- <div class="min-h-0">
        <LeftGlobalSettingsPane class="h-full" />
      </div> -->

      <!-- 3) Layout settings：固定高度（随屏幕 clamp）+ 底部 4px -->
      <div class="min-h-0 pb-[4px]">
        <LeftLayoutSettingsPane
          class="h-full"
          @apply-layout-settings="handleApplyLayoutSettings"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import LeftSessionsPane from './LeftSessionsPane.vue'
// import LeftGlobalSettingsPane from './LeftGlobalSettingsPane.vue'
import LeftLayoutSettingsPane from './LeftLayoutSettingsPane.vue'

const handleApplyLayoutSettings = (payload: {
  horizontalGap: number
  verticalGap: number
  colors: { image: string; video: string; audio: string; overlap: string }
}) => {
  window.dispatchEvent(new CustomEvent('layout-settings-changed', { detail: payload }))
}
</script>

<style scoped>
.left-grid {
  display: grid;
  grid-template-rows: minmax(0, 1fr) var(--ll-h);
  gap: 10px;
  min-height: 0;
}

:root {
  --ll-h: clamp(220px, 30vh, 320px);
}

@media (max-height: 760px) {
  :root {
    --ll-h: clamp(180px, 28vh, 260px);
  }
}
</style>
