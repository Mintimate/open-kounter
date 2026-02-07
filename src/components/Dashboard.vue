<script setup>
import { ref } from 'vue'
import CounterList from './dashboard/CounterList.vue'
import DataBackup from './dashboard/DataBackup.vue'
import DomainConfig from './dashboard/DomainConfig.vue'
import PasskeyManager from './dashboard/PasskeyManager.vue'
import SingleCounterManager from './dashboard/SingleCounterManager.vue'
import TotalStats from './dashboard/TotalStats.vue'

defineProps(['token'])

const totalCount = ref(0)
const counterListRef = ref(null)
const domainConfigRef = ref(null)

const handleRefreshList = () => {
  counterListRef.value?.loadCounters()
}

const handleFullRefresh = () => {
  counterListRef.value?.loadCounters()
  domainConfigRef.value?.loadConfig()
}
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
    <!-- 左侧：列表 (3/4) -->
    <div class="lg:col-span-3">
      <CounterList 
        ref="counterListRef" 
        :token="token" 
        @update:totalCount="totalCount = $event" 
      />
    </div>

    <!-- 右侧：工具栏 (1/4) -->
    <div class="space-y-4">
      <TotalStats :totalCount="totalCount" />
      
      <SingleCounterManager 
        :token="token" 
        @refresh="handleRefreshList" 
      />

      <PasskeyManager :token="token" />
      
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
</template>
