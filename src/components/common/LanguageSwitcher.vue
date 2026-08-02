<script setup>
import { computed } from 'vue'

import { useI18n } from 'vue-i18n'

const { locale, t } = useI18n()
const emit = defineEmits(['change'])

const nextLocale = computed(() => locale.value === 'zh-CN' ? 'en-US' : 'zh-CN')
const currentLabel = computed(() => locale.value === 'zh-CN' ? '中' : 'EN')
const nextLabel = computed(() => nextLocale.value === 'zh-CN' ? t('language.zhCN') : t('language.enUS'))
</script>

<template>
  <button
    type="button"
    class="button-secondary button-compact min-w-10 px-2"
    :aria-label="t('language.ariaLabel')"
    :title="nextLabel"
    @click="emit('change', nextLocale)"
  >
    <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M3 5h12M9 3v2m1.5 0c-.7 4.2-3.1 7.6-6.5 9.5m2-6c1.8 2.8 4.1 5 7 6.5M15 13l4 8m0-8-4 8m1.2-2.5h5.6" />
    </svg>
    <span class="text-[11px] font-semibold">{{ currentLabel }}</span>
  </button>
</template>
