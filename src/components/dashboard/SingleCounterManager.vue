<script setup>
import { ref } from 'vue'

const props = defineProps(['token'])
const emit = defineEmits(['refresh'])

const target = ref('')
const value = ref(0)
const result = ref(null)
const singleError = ref('')
const singleLoading = ref(false)

const callApi = async (action, payload = {}) => {
  singleLoading.value = true
  singleError.value = ''
  result.value = null
  
  try {
    let url = '/api/counter'
    let options = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      }
    }

    if (action === 'get') {
      url += `?target=${encodeURIComponent(target.value)}`
      options.method = 'GET'
    } else {
      options.method = 'POST'
      options.body = JSON.stringify({
        action,
        target: target.value,
        ...payload
      })
    }

    const res = await fetch(url, options)
    const data = await res.json()
    
    if (data.code === 0) {
      result.value = data.data
      if (data.data.time !== undefined) {
        value.value = data.data.time
      }
      // Refresh list if needed
      emit('refresh')
    } else {
      singleError.value = data.message
    }
  } catch (e) {
    singleError.value = e.message
  } finally {
    singleLoading.value = false
  }
}

const handleGet = () => {
  if (!target.value) return
  callApi('get')
}

const handleSet = () => {
  if (!target.value) return
  callApi('set', { value: parseInt(value.value) })
}

const handleDelete = () => {
  if (!target.value) return
  if (!confirm(`确定要删除 "${target.value}" 的计数器吗？`)) return
  callApi('delete')
}
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <h3 class="text-base font-semibold text-white mb-1">管理单个计数器</h3>
    <p class="text-xs text-gray-500 mb-3">查询、修改或删除指定 Key</p>
    
    <div class="space-y-2">
      <div>
        <div class="flex gap-2">
          <input 
            v-model="target" 
            placeholder="Target Key" 
            class="flex-1 px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary transition-colors" 
          />
          <button 
            @click="handleGet" 
            :disabled="singleLoading" 
            class="px-3 py-1.5 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            查询
          </button>
        </div>
      </div>

      <div v-if="result || target" class="pt-2 border-t border-dark-700">
        <div class="flex gap-2">
          <input 
            type="number" 
            v-model="value" 
            placeholder="Value"
            class="flex-1 px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary transition-colors" 
          />
          <button 
            @click="handleSet" 
            :disabled="singleLoading" 
            class="px-3 py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            更新
          </button>
        </div>
      </div>

      <div v-if="target" class="pt-2 border-t border-dark-700">
        <button 
          @click="handleDelete" 
          :disabled="singleLoading" 
          class="w-full py-1 border border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs rounded-lg transition-colors disabled:opacity-50"
        >
          删除此计数器
        </button>
      </div>

      <div v-if="result" class="mt-2 p-2 bg-black rounded-lg border border-dark-700 overflow-x-auto">
        <pre class="text-xs text-green-400 font-mono">{{ JSON.stringify(result, null, 2) }}</pre>
      </div>

      <div v-if="singleError" class="text-xs text-red-400 mt-1">{{ singleError }}</div>
    </div>
  </div>
</template>
