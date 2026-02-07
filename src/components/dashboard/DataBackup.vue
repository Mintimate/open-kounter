<script setup>
import { ref } from 'vue'

const props = defineProps(['token'])
const emit = defineEmits(['refresh'])

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
      emit('refresh')
    } else {
      alert('导入失败: ' + data.message)
    }
  } catch (e) {
    alert('导入出错: ' + e.message)
  } finally {
    importLoading.value = false
  }
}
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <h3 class="text-base font-semibold text-white mb-1">数据备份</h3>
    <p class="text-xs text-gray-500 mb-3">导出数据或从备份恢复</p>
    
    <div class="flex gap-2">
      <button 
        @click="handleExport" 
        class="flex-1 py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        导出
      </button>
      
      <div class="relative flex-1">
        <input 
          type="file" 
          ref="fileInput" 
          accept=".json" 
          class="hidden" 
          @change="handleFileChange" 
        />
        <button 
          @click="triggerImport" 
          class="w-full py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          导入
        </button>
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
</template>
