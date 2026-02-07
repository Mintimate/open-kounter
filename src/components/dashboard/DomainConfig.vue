<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps(['token'])

const allowedDomains = ref([])
const newDomain = ref('')
const configLoading = ref(false)
const configError = ref('')

const loadConfig = async () => {
  configLoading.value = true
  configError.value = ''
  
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'get_config'
      })
    })
    
    const data = await res.json()
    
    if (data.code === 0) {
      allowedDomains.value = data.data.allowedDomains
    } else {
      configError.value = data.message
    }
  } catch (e) {
    configError.value = e.message
  } finally {
    configLoading.value = false
  }
}

const saveConfig = async () => {
  configLoading.value = true
  configError.value = ''
  
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'set_config',
        allowedDomains: allowedDomains.value
      })
    })
    
    const data = await res.json()
    
    if (data.code === 0) {
      alert('配置保存成功！')
    } else {
      configError.value = data.message
    }
  } catch (e) {
    configError.value = e.message
  } finally {
    configLoading.value = false
  }
}

const addDomain = () => {
  if (!newDomain.value.trim()) return
  if (!allowedDomains.value.includes(newDomain.value.trim())) {
    allowedDomains.value.push(newDomain.value.trim())
    newDomain.value = ''
  }
}

const removeDomain = (index) => {
  allowedDomains.value.splice(index, 1)
}

onMounted(() => {
  loadConfig()
})

defineExpose({ loadConfig })
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <h3 class="text-base font-semibold text-white mb-1">域名白名单</h3>
    <p class="text-xs text-gray-500 mb-3">配置允许调用的来源</p>
    
    <div class="bg-blue-500/10 border-l-2 border-blue-500 p-2 mb-3">
      <p class="text-xs text-blue-200 leading-relaxed">
        留空允许所有。支持通配符 <code>*</code>。
      </p>
    </div>

    <div class="space-y-3">
      <div class="flex gap-2">
        <input 
          v-model="newDomain" 
          placeholder="https://example.com"
          @keyup.enter="addDomain"
          class="flex-1 px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary transition-colors"
        />
        <button 
          @click="addDomain" 
          :disabled="configLoading" 
          class="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
        >
          添加
        </button>
      </div>

      <div class="space-y-2 max-h-32 overflow-y-auto pr-1">
        <div v-for="(domain, index) in allowedDomains" :key="index" class="flex justify-between items-center p-1.5 bg-dark-900 rounded border border-dark-700 group">
          <span class="text-xs font-mono text-gray-300 truncate">{{ domain }}</span>
          <button @click="removeDomain(index)" class="text-gray-500 hover:text-red-400 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
        <div v-if="allowedDomains.length === 0" class="text-center py-2 text-xs text-gray-600">
          未配置（允许所有）
        </div>
      </div>

      <button 
        @click="saveConfig" 
        :disabled="configLoading" 
        class="w-full py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 disabled:opacity-50 mt-1"
      >
        {{ configLoading ? '保存中...' : '保存配置' }}
      </button>

      <div v-if="configError" class="text-xs text-red-400 mt-1">{{ configError }}</div>
    </div>
  </div>
</template>
