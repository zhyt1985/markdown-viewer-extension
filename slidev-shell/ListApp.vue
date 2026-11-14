<script setup lang="ts">
/**
 * List mode app — renders all slides stacked vertically.
 * Each slide rendered at native resolution then CSS-scaled to fit the panel.
 */
import { computed, ref, watchEffect } from 'vue'
import { useElementSize } from '@vueuse/core'
import { slides } from '#slidev/slides'
import { slideWidth, slideHeight, themeVars } from '@slidev/client/env'
import ListSlide from './ListSlide.vue'

// Apply theme CSS variables
watchEffect(() => {
  for (const [key, value] of Object.entries(themeVars.value))
    document.body.style.setProperty(key, value.toString())
})

const rootRef = ref<HTMLElement>()
const props = defineProps<{ print?: boolean }>()
const { width: containerWidth } = useElementSize(rootRef)

// Scale factor: fit slide width into available container width
const listScale = computed(() => {
  if (props.print) return 1
  const available = containerWidth.value - 8 // 4px padding each side
  if (available <= 0 || slideWidth.value <= 0) return 1
  return Math.min(1, available / slideWidth.value)
})

watchEffect(() => {
  if (!props.print) return
  document.documentElement.classList.add('documd-slidev-print')
  let style = document.getElementById('documd-slidev-paper')
  if (!style) {
    style = document.createElement('style')
    style.id = 'documd-slidev-paper'
    document.head.append(style)
  }
  // Chromium rounds PDF paper dimensions down to print units. A pixel of
  // vertical clearance keeps an otherwise exact-fit slide on one page.
  style.textContent = `@page { size: ${slideWidth.value}px ${slideHeight.value + 1}px; margin: 0; }`
})

const allSlides = computed(() =>
  slides.value.map((route) => {
    route.meta.__preloaded = true
    return route
  }),
)
</script>

<template>
  <div ref="rootRef" class="slidev-list-root">
    <div
      v-for="route in allSlides"
      :key="route.no"
      class="slidev-list-item"
      :style="{
        width: slideWidth * listScale + 'px',
        height: slideHeight * listScale + 'px',
      }"
    >
      <ListSlide
        :route="route"
        :style="{ transform: `scale(${listScale})` }"
      />
      <div v-if="!print" class="slidev-list-badge">{{ route.no }} / {{ allSlides.length }}</div>
    </div>
  </div>
</template>

<style>
/* Override global styles for list mode */
html, body, #app {
  height: auto !important;
  overflow: auto !important;
}
@media print {
  html.documd-slidev-print body { margin: 0 !important; }
  html.documd-slidev-print .slidev-list-root { padding: 0; min-height: 0; overflow: visible; }
  html.documd-slidev-print .slidev-list-item { margin: 0; border: 0; border-radius: 0; break-inside: avoid; }
  html.documd-slidev-print .slidev-list-item:not(:last-child) { break-after: page; }
}
</style>

<style scoped>
.slidev-list-root {
  padding: 4px;
  overflow-y: auto;
  width: 100%;
  background: #000;
  min-height: 100vh;
}

.slidev-list-item {
  position: relative;
  margin: 4px auto;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 4px;
  overflow: hidden;
}

.slidev-list-badge {
  position: absolute;
  bottom: 6px;
  right: 10px;
  font-size: 11px;
  opacity: 0.35;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  z-index: 10;
}
</style>
