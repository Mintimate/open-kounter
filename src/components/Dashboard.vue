<script setup>
import { ref } from 'vue'
import CounterList from './dashboard/CounterList.vue'
import TotalStats from './dashboard/TotalStats.vue'
import SingleCounterManager from './dashboard/SingleCounterManager.vue'
import DomainConfig from './dashboard/DomainConfig.vue'
import DataBackup from './dashboard/DataBackup.vue'

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
  <div class="space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 左侧：列表 (2/3) -->
      <div class="lg:col-span-2 space-y-6">
        <CounterList 
          ref="counterListRef" 
          :token="token" 
          @update:totalCount="totalCount = $event" 
        />
      </div>

      <!-- 右侧：工具栏 (1/3) -->
      <div class="space-y-6">
        <TotalStats :totalCount="totalCount" />
        
        <SingleCounterManager 
          :token="token" 
          @refresh="handleRefreshList" 
        />
        
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
