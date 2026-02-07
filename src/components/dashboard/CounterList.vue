<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps(['token'])
const emit = defineEmits(['update:totalCount'])

const counters = ref([])
const currentPage = ref(1)
const pageSize = ref(20)
const totalPages = ref(0)
const loading = ref(false)
const error = ref('')

const loadCounters = async () => {
  loading.value = true
  error.value = ''
  
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'list',
        page: currentPage.value,
        pageSize: pageSize.value
      })
    })
    
    const data = await res.json()
    
    if (data.code === 0) {
      counters.value = data.data.items
      totalPages.value = data.data.totalPages
      emit('update:totalCount', data.data.total)
    } else {
      error.value = data.message
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const deleteCounter = async (targetKey) => {
  if (!confirm(`确定要删除 "${targetKey}" 的计数器吗？`)) return
  
  loading.value = true
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'delete',
        target: targetKey
      })
    })
    
    const data = await res.json()
    
    if (data.code === 0) {
      loadCounters()
    } else {
      error.value = data.message
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadCounters()
}

onMounted(() => {
  loadCounters()
})

defineExpose({ loadCounters })
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm overflow-hidden">
    <div class="p-6 border-b border-dark-700 flex justify-between items-center bg-dark-800/50">
      <h3 class="text-lg font-semibold text-white">计数器列表</h3>
      <button 
        @click="loadCounters" 
        :disabled="loading"
        class="px-3 py-1.5 text-sm bg-dark-700 hover:bg-dark-600 text-gray-200 rounded-md transition-colors border border-dark-600"
      >
        {{ loading ? '加载中...' : '刷新' }}
      </button>
    </div>

    <div v-if="error" class="m-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm">
      {{ error }}
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-dark-900/50 border-b border-dark-700 text-xs uppercase text-gray-400">
            <th class="px-6 py-4 font-medium">Target Key</th>
            <th class="px-6 py-4 font-medium">计数</th>
            <th class="px-6 py-4 font-medium text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-dark-700">
          <tr v-for="item in counters" :key="item.target" class="hover:bg-dark-700/30 transition-colors">
            <td class="px-6 py-4 font-mono text-primary text-sm">{{ item.target }}</td>
            <td class="px-6 py-4 font-bold text-green-400">{{ item.count }}</td>
            <td class="px-6 py-4 text-right">
              <button 
                @click="deleteCounter(item.target)" 
                class="text-xs text-red-400 hover:text-red-300 hover:underline disabled:opacity-50"
                :disabled="loading"
              >
                删除
              </button>
            </td>
          </tr>
          <tr v-if="counters.length === 0 && !loading">
            <td colspan="3" class="px-6 py-12 text-center text-gray-500 text-sm">
              暂无数据。计数器将在第一次调用 increment 时自动创建。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Pagination -->
    <div v-if="counters.length > 0" class="px-6 py-4 border-t border-dark-700 flex justify-center items-center gap-4">
      <button 
        class="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400"
        @click="goToPage(currentPage - 1)" 
        :disabled="currentPage === 1 || loading"
      >
        上一页
      </button>
      <span class="text-sm text-gray-500">
        {{ currentPage }} / {{ totalPages }}
      </span>
      <button 
        class="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400"
        @click="goToPage(currentPage + 1)" 
        :disabled="currentPage === totalPages || loading"
      >
        下一页
      </button>
    </div>
  </div>
</template>
