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

// Edit state
const showEditModal = ref(false)
const editingTarget = ref('')
const editValue = ref(0)
const editLoading = ref(false)

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

const handlePageSizeChange = () => {
  currentPage.value = 1
  loadCounters()
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

const openEditModal = (item) => {
  editingTarget.value = item.target
  editValue.value = item.count
  showEditModal.value = true
}

const updateCounter = async () => {
  if (editValue.value < 0) {
    alert('计数值不能为负数')
    return
  }
  
  editLoading.value = true
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'set',
        target: editingTarget.value,
        value: editValue.value
      })
    })
    
    const data = await res.json()
    
    if (data.code === 0) {
      showEditModal.value = false
      loadCounters()
    } else {
      alert(data.message || '更新失败')
    }
  } catch (e) {
    alert('更新失败: ' + e.message)
  } finally {
    editLoading.value = false
  }
}

const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadCounters()
}

const formatDate = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

onMounted(() => {
  loadCounters()
})

defineExpose({ loadCounters })
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm overflow-hidden">
    <div class="p-4 border-b border-dark-700 flex justify-between items-center bg-dark-800/50">
      <h3 class="text-base font-semibold text-white">计数器列表</h3>
      <div class="flex items-center gap-2">
        <select 
          v-model="pageSize" 
          @change="handlePageSizeChange"
          class="px-2 py-1.5 text-xs bg-dark-700 text-gray-200 rounded-md border border-dark-600 focus:outline-none focus:border-primary cursor-pointer"
        >
          <option :value="10">10 条/页</option>
          <option :value="20">20 条/页</option>
          <option :value="50">50 条/页</option>
          <option :value="100">100 条/页</option>
        </select>
        <button 
          @click="loadCounters" 
          :disabled="loading"
          class="px-3 py-1.5 text-xs bg-dark-700 hover:bg-dark-600 text-gray-200 rounded-md transition-colors border border-dark-600"
        >
          {{ loading ? '加载中...' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="error" class="m-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">
      {{ error }}
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse table-fixed">
        <thead>
          <tr class="bg-dark-900/50 border-b border-dark-700 text-xs uppercase text-gray-400">
            <th class="px-4 py-3 font-medium">Target Key</th>
            <th class="px-4 py-3 font-medium w-24">计数</th>
            <th class="px-4 py-3 font-medium w-40">创建时间</th>
            <th class="px-4 py-3 font-medium w-40">更新时间</th>
            <th class="px-4 py-3 font-medium text-right w-32">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-dark-700">
          <tr v-for="item in counters" :key="item.target" class="hover:bg-dark-700/30 transition-colors">
            <td class="px-4 py-3 font-mono text-primary text-sm truncate" :title="item.target">{{ item.target }}</td>
            <td class="px-4 py-3 font-bold text-green-400 truncate" :title="item.count">{{ item.count }}</td>
            <td class="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{{ formatDate(item.created_at) }}</td>
            <td class="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{{ formatDate(item.updated_at) }}</td>
            <td class="px-4 py-3 text-right space-x-2 whitespace-nowrap">
              <button 
                @click="openEditModal(item)" 
                class="text-xs text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50"
                :disabled="loading"
              >
                编辑
              </button>
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
            <td colspan="5" class="px-4 py-8 text-center text-gray-500 text-xs">
              暂无数据。计数器将在第一次调用 increment 时自动创建。
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Pagination -->
    <div v-if="counters.length > 0" class="px-4 py-3 border-t border-dark-700 flex justify-center items-center gap-4">
      <button 
        class="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400"
        @click="goToPage(currentPage - 1)" 
        :disabled="currentPage === 1 || loading"
      >
        上一页
      </button>
      <span class="text-xs text-gray-500">
        {{ currentPage }} / {{ totalPages }}
      </span>
      <button 
        class="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 disabled:hover:text-gray-400"
        @click="goToPage(currentPage + 1)" 
        :disabled="currentPage === totalPages || loading"
      >
        下一页
      </button>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-md shadow-xl">
        <h3 class="text-lg font-semibold text-white mb-4">修改计数器</h3>
        
        <div class="mb-4">
          <label class="block text-xs text-gray-400 mb-1">Target Key (不可修改)</label>
          <input 
            type="text" 
            :value="editingTarget" 
            disabled
            class="w-full px-3 py-2 bg-dark-900 border border-dark-700 rounded-lg text-gray-500 text-sm"
          />
        </div>
        
        <div class="mb-6">
          <label class="block text-xs text-gray-400 mb-1">计数值</label>
          <input 
            type="number" 
            v-model="editValue" 
            class="w-full px-3 py-2 bg-dark-900 border border-dark-700 rounded-lg text-white text-sm focus:border-primary focus:outline-none"
          />
        </div>
        
        <div class="flex justify-end gap-3">
          <button 
            @click="showEditModal = false"
            class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
            :disabled="editLoading"
          >
            取消
          </button>
          <button 
            @click="updateCounter"
            class="px-4 py-2 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50"
            :disabled="editLoading"
          >
            {{ editLoading ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
