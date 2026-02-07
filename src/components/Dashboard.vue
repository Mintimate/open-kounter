<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps(['token'])

// List view
const counters = ref([])
const currentPage = ref(1)
const pageSize = ref(20)
const totalPages = ref(0)
const totalCount = ref(0)
const loading = ref(false)
const error = ref('')

// Single counter management
const target = ref('')
const value = ref(0)
const result = ref(null)
const singleError = ref('')
const singleLoading = ref(false)

// Config management
const allowedDomains = ref([])
const newDomain = ref('')
const configLoading = ref(false)
const configError = ref('')

// Load counter list
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
      totalCount.value = data.data.total
    } else {
      error.value = data.message
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

// Load config
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

// Save config
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

// Add domain
const addDomain = () => {
  if (!newDomain.value.trim()) return
  if (!allowedDomains.value.includes(newDomain.value.trim())) {
    allowedDomains.value.push(newDomain.value.trim())
    newDomain.value = ''
  }
}

// Remove domain
const removeDomain = (index) => {
  allowedDomains.value.splice(index, 1)
}

// Import/Export Logic
const importLoading = ref(false)
const showImportModal = ref(false)
const importConfirmText = ref('')
const importData = ref(null)
const fileInput = ref(null)

const handleExport = async () => {
  const btn = document.activeElement
  const originalText = btn.innerText
  btn.innerText = '导出中...'
  btn.disabled = true
  
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'export_all'
      })
    })
    
    const data = await res.json()
    
    if (data.code === 0) {
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `open-kounter-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } else {
      alert('导出失败: ' + data.message)
    }
  } catch (e) {
    alert('导出出错: ' + e.message)
  } finally {
    btn.innerText = originalText
    btn.disabled = false
  }
}

const triggerImport = () => {
  fileInput.value.click()
}

const handleFileChange = (event) => {
  const file = event.target.files[0]
  if (!file) return
  
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result)
      if (!json.counters || !json.allowedDomains) {
        throw new Error('无效的备份文件格式：缺少必要字段')
      }
      importData.value = json
      importConfirmText.value = ''
      showImportModal.value = true
    } catch (err) {
      alert('解析文件失败: ' + err.message)
    }
    // Reset input to allow selecting same file again
    event.target.value = ''
  }
  reader.readAsText(file)
}

const closeImportModal = () => {
  showImportModal.value = false
  importData.value = null
  importConfirmText.value = ''
}

const executeImport = async () => {
  if (importConfirmText.value !== '我确认覆盖全部数据') {
    return
  }
  
  importLoading.value = true
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'import_all',
        data: importData.value
      })
    })
    
    const data = await res.json()
    if (data.code === 0) {
      alert(`导入成功！共恢复 ${data.data.imported} 个计数器。`)
      closeImportModal()
      loadCounters()
      loadConfig()
    } else {
      alert('导入失败: ' + data.message)
    }
  } catch (e) {
    alert('导入出错: ' + e.message)
  } finally {
    importLoading.value = false
  }
}

// Single counter operations
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
      loadCounters()
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

// Delete from list
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

// Pagination
const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadCounters()
}

onMounted(() => {
  loadCounters()
  loadConfig()
})
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <!-- 左侧：列表 (2/3) -->
      <div class="lg:col-span-2 space-y-6">
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
      </div>

      <!-- 右侧：工具栏 (1/3) -->
      <div class="space-y-6">
        <!-- 总计数器统计 (移动到这里) -->
        <div class="bg-dark-800 p-6 rounded-xl border border-dark-700 shadow-sm">
          <h3 class="text-gray-400 text-xs font-medium uppercase tracking-wider">总计数器</h3>
          <div class="mt-2 flex items-baseline gap-2">
            <span class="text-3xl font-bold text-white">{{ totalCount }}</span>
            <span class="text-sm text-gray-500">个</span>
          </div>
        </div>

        <!-- 管理单个 -->
        <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-6">
          <h3 class="text-lg font-semibold text-white mb-1">管理单个计数器</h3>
          <p class="text-sm text-gray-500 mb-6">查询、修改或删除指定 Key</p>
          
          <div class="space-y-4">
            <div>
              <label class="block text-xs text-gray-400 mb-1.5">Target Key</label>
              <div class="flex gap-2">
                <input 
                  v-model="target" 
                  placeholder="例如：site-pv" 
                  class="flex-1 px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary transition-colors" 
                />
                <button 
                  @click="handleGet" 
                  :disabled="singleLoading" 
                  class="px-4 py-2 bg-primary hover:bg-primary-hover text-white text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  查询
                </button>
              </div>
            </div>

            <div v-if="result || target" class="pt-4 border-t border-dark-700">
              <label class="block text-xs text-gray-400 mb-1.5">当前数值</label>
              <div class="flex gap-2">
                <input 
                  type="number" 
                  v-model="value" 
                  class="flex-1 px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary transition-colors" 
                />
                <button 
                  @click="handleSet" 
                  :disabled="singleLoading" 
                  class="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
                >
                  更新
                </button>
              </div>
            </div>

            <div v-if="target" class="pt-4 border-t border-dark-700">
              <button 
                @click="handleDelete" 
                :disabled="singleLoading" 
                class="w-full py-2 border border-red-500/30 text-red-400 hover:bg-red-500/10 text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                删除此计数器
              </button>
            </div>

            <div v-if="result" class="mt-4 p-3 bg-black rounded-lg border border-dark-700 overflow-x-auto">
              <pre class="text-xs text-green-400 font-mono">{{ JSON.stringify(result, null, 2) }}</pre>
            </div>

            <div v-if="singleError" class="text-xs text-red-400 mt-2">{{ singleError }}</div>
          </div>
        </div>

        <!-- 白名单配置 -->
        <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-6">
          <h3 class="text-lg font-semibold text-white mb-1">域名白名单</h3>
          <p class="text-sm text-gray-500 mb-4">配置允许调用的来源</p>
          
          <div class="bg-blue-500/10 border-l-2 border-blue-500 p-3 mb-6">
            <p class="text-xs text-blue-200 leading-relaxed">
              留空允许所有。支持通配符 <code>*</code>。
            </p>
          </div>

          <div class="space-y-4">
            <div class="flex gap-2">
              <input 
                v-model="newDomain" 
                placeholder="https://example.com"
                @keyup.enter="addDomain"
                class="flex-1 px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary transition-colors"
              />
              <button 
                @click="addDomain" 
                :disabled="configLoading" 
                class="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                添加
              </button>
            </div>

            <div class="space-y-2 max-h-48 overflow-y-auto pr-1">
              <div v-for="(domain, index) in allowedDomains" :key="index" class="flex justify-between items-center p-2 bg-dark-900 rounded border border-dark-700 group">
                <span class="text-xs font-mono text-gray-300 truncate">{{ domain }}</span>
                <button @click="removeDomain(index)" class="text-gray-500 hover:text-red-400 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
              <div v-if="allowedDomains.length === 0" class="text-center py-4 text-xs text-gray-600">
                未配置（允许所有）
              </div>
            </div>

            <button 
              @click="saveConfig" 
              :disabled="configLoading" 
              class="w-full py-2 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 disabled:opacity-50 mt-2"
            >
              {{ configLoading ? '保存中...' : '保存配置' }}
            </button>

            <div v-if="configError" class="text-xs text-red-400 mt-2">{{ configError }}</div>
          </div>
        </div>

        <!-- 数据备份与恢复 -->
        <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-6">
          <h3 class="text-lg font-semibold text-white mb-1">数据备份与恢复</h3>
          <p class="text-sm text-gray-500 mb-4">导出所有数据或从备份恢复</p>
          
          <div class="space-y-3">
            <button 
              @click="handleExport" 
              class="w-full py-2 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              导出数据 (JSON)
            </button>
            
            <div class="relative">
              <input 
                type="file" 
                ref="fileInput" 
                accept=".json" 
                class="hidden" 
                @change="handleFileChange" 
              />
              <button 
                @click="triggerImport" 
                class="w-full py-2 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                导入数据 (JSON)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Import Confirmation Modal -->
    <div v-if="showImportModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-2xl max-w-md w-full p-6 space-y-6">
        <div>
          <h3 class="text-xl font-bold text-white mb-2">⚠️ 危险操作确认</h3>
          <p class="text-gray-400 text-sm leading-relaxed">
            您正在尝试导入数据。此操作将 <span class="text-red-400 font-bold">永久覆盖并删除</span> 当前所有的计数器和配置数据。
          </p>
          <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
            <p>包含计数器：<span class="text-white">{{ importData ? Object.keys(importData.counters).length : 0 }}</span> 个</p>
            <p>包含配置项：<span class="text-white">{{ importData ? (importData.allowedDomains || []).length : 0 }}</span> 个</p>
          </div>
        </div>

        <div class="space-y-2">
          <label class="block text-sm text-gray-300">
            请输入 <span class="select-all font-mono text-red-400 bg-red-500/10 px-1 rounded">我确认覆盖全部数据</span> 以继续：
          </label>
          <input 
            v-model="importConfirmText" 
            type="text" 
            class="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-red-500 transition-colors"
            placeholder="在此输入确认文本"
          />
        </div>

        <div class="flex gap-3 pt-2">
          <button 
            @click="closeImportModal" 
            class="flex-1 py-2 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600"
          >
            取消
          </button>
          <button 
            @click="executeImport" 
            :disabled="importConfirmText !== '我确认覆盖全部数据' || importLoading"
            class="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {{ importLoading ? '恢复中...' : '确认覆盖导入' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
