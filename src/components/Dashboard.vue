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

const summary = ref(null)
const summaryState = ref({ loading: true, error: '' })
const counterListRef = ref(null)
const domainConfigRef = ref(null)

const handleRefreshList = () => {
  counterListRef.value?.loadCounters()
}

const handleFullRefresh = () => {
  handleRefreshList()
  domainConfigRef.value?.loadConfig()
}
</script>

<template>
  <div class="space-y-5">
    <AnalyticsOverview
      :summary="summary"
      :loading="summaryState.loading"
      :error="summaryState.error"
      @refresh="handleRefreshList"
    />

    <div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-4">
      <div class="lg:col-span-3">
        <CounterList
          ref="counterListRef"
          :token="token"
          @summary="summary = $event"
          @load-state="summaryState = $event"
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
