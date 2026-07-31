<script setup>
import { ref } from 'vue'

import AnalyticsOverview from './dashboard/AnalyticsOverview.vue'
import CounterList from './dashboard/CounterList.vue'
import DataBackup from './dashboard/DataBackup.vue'
import DomainConfig from './dashboard/DomainConfig.vue'
import OidcManager from './dashboard/OidcManager.vue'
import PasskeyManager from './dashboard/PasskeyManager.vue'
import SingleCounterManager from './dashboard/SingleCounterManager.vue'

defineProps(['token'])

const analyticsOverviewRef = ref(null)
const counterListRef = ref(null)
const domainConfigRef = ref(null)

const handleRefreshList = () => {
  counterListRef.value?.loadCounters()
  analyticsOverviewRef.value?.loadSummary()
}

const handleCounterChanged = () => {
  analyticsOverviewRef.value?.loadSummary()
}

const handleFullRefresh = () => {
  handleRefreshList()
  domainConfigRef.value?.loadConfig()
}
</script>

<template>
  <div class="space-y-5">
    <AnalyticsOverview ref="analyticsOverviewRef" :token="token" />

    <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-4">
      <div class="lg:col-span-3">
        <CounterList
          ref="counterListRef"
          :token="token"
          @changed="handleCounterChanged"
        />
      </div>

      <div class="space-y-4">
        <SingleCounterManager
          :token="token"
          @refresh="handleRefreshList"
        />

        <PasskeyManager :token="token" />

        <OidcManager :token="token" />

        <DomainConfig
          ref="domainConfigRef"
          :token="token"
        />

        <DataBackup
          :token="token"
          @refresh="handleFullRefresh"
        />
      </div>
    </div>
  </div>
</template>
