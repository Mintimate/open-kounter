<script setup>
import { computed, onMounted, ref } from 'vue'

import { useI18n } from 'vue-i18n'

const props = defineProps(['token'])
const { locale, t } = useI18n()

const summary = ref(null)
const loading = ref(false)
const error = ref('')

const metricCards = computed(() => [
  {
    label: t('analytics.pv'),
    value: summary.value?.sitePv || 0,
    unit: t('analytics.timesUnit'),
    valueClass: 'text-primary'
  },
  {
    label: t('analytics.uv'),
    value: summary.value?.siteUv || 0,
    unit: t('analytics.peopleUnit'),
    valueClass: 'text-success'
  },
  {
    label: t('analytics.pageCounters'),
    value: summary.value?.pageCounters || 0,
    unit: t('analytics.countUnit'),
    valueClass: 'text-white'
  },
  {
    label: t('analytics.allCounters'),
    value: summary.value?.totalCounters || 0,
    unit: t('analytics.countUnit'),
    valueClass: 'text-white'
  },
  {
    label: t('analytics.staleCounters'),
    value: summary.value?.staleCounters || 0,
    unit: t('analytics.countUnit'),
    valueClass: 'text-warning'
  },
  {
    label: t('analytics.zeroCounters'),
    value: summary.value?.zeroCounters || 0,
    unit: t('analytics.countUnit'),
    valueClass: 'text-danger'
  }
])

const topPageMaximum = computed(() => Math.max(
  1,
  ...(summary.value?.topPages || []).map((item) => Number(item.count) || 0)
))

const loadSummary = async () => {
  loading.value = true
  error.value = ''

  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({ action: 'summary' })
    })
    const data = await res.json()

    if (data.code === 0) {
      summary.value = data.data
    } else {
      error.value = data.message || t('analytics.loadFailed')
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const formatNumber = (value) => new Intl.NumberFormat(locale.value).format(Number(value) || 0)

const formatDate = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString(locale.value)
}

const getBarWidth = (count) => {
  const value = Number(count) || 0
  if (value <= 0) return '0%'
  return `${Math.max(4, Math.round((value / topPageMaximum.value) * 100))}%`
}

onMounted(loadSummary)

defineExpose({ loadSummary })
</script>

<template>
  <section class="space-y-3" aria-labelledby="analytics-overview-title">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 id="analytics-overview-title" class="text-base font-semibold text-white">{{ t('analytics.overview') }}</h2>
        <p class="mt-0.5 text-xs text-gray-500">
          {{ t('analytics.lastWrite', { date: formatDate(summary?.latestUpdatedAt) }) }}
        </p>
      </div>
      <button
        type="button"
        class="button-secondary button-compact self-start sm:self-auto"
        :disabled="loading"
        @click="loadSummary"
      >
        {{ loading ? t('common.loading') : t('analytics.refresh') }}
      </button>
    </div>

    <div v-if="error" class="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-400">
      {{ error }}
    </div>

    <div class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <div
        v-for="metric in metricCards"
        :key="metric.label"
        class="min-h-24 rounded-lg border border-dark-700/60 bg-dark-800 p-4 shadow-sm"
      >
        <p class="text-xs font-medium text-gray-500">{{ metric.label }}</p>
        <div class="mt-3 flex min-w-0 items-baseline gap-1.5">
          <span class="truncate text-2xl font-bold" :class="metric.valueClass">
            {{ formatNumber(metric.value) }}
          </span>
          <span class="shrink-0 text-xs text-gray-500">{{ metric.unit }}</span>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div class="overflow-hidden rounded-lg border border-dark-700/60 bg-dark-800 shadow-sm">
        <div class="border-b border-dark-700/60 px-4 py-3">
          <h3 class="text-sm font-semibold text-white">{{ t('analytics.topPages') }}</h3>
        </div>
        <div v-if="summary?.topPages?.length" class="divide-y divide-dark-700/50">
          <div v-for="item in summary.topPages" :key="item.target" class="relative px-4 py-2.5">
            <div
              class="absolute inset-y-1.5 left-0 bg-primary/10"
              :style="{ width: getBarWidth(item.count) }"
            ></div>
            <div class="relative flex min-w-0 items-center justify-between gap-4">
              <span class="truncate font-mono text-xs text-gray-300" :title="item.target">
                {{ item.target }}
              </span>
              <span class="shrink-0 text-xs font-semibold text-primary">{{ formatNumber(item.count) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="px-4 py-8 text-center text-xs text-gray-500">{{ t('analytics.noPageViews') }}</div>
      </div>

      <div class="overflow-hidden rounded-lg border border-dark-700/60 bg-dark-800 shadow-sm">
        <div class="border-b border-dark-700/60 px-4 py-3">
          <h3 class="text-sm font-semibold text-white">{{ t('analytics.recentActivity') }}</h3>
        </div>
        <div v-if="summary?.recentlyActive?.length" class="divide-y divide-dark-700/50">
          <div
            v-for="item in summary.recentlyActive"
            :key="item.target"
            class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2.5"
          >
            <span class="truncate font-mono text-xs text-gray-300" :title="item.target">
              {{ item.target }}
            </span>
            <div class="text-right">
              <p class="text-xs font-semibold text-success">{{ formatNumber(item.count) }}</p>
              <p class="mt-0.5 text-[11px] text-gray-500">{{ formatDate(item.updated_at) }}</p>
            </div>
          </div>
        </div>
        <div v-else class="px-4 py-8 text-center text-xs text-gray-500">{{ t('analytics.noActivePages') }}</div>
      </div>
    </div>
  </section>
</template>
