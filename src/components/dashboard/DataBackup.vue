<script setup>
import { ref } from 'vue'
import ConfirmModal from '../common/ConfirmModal.vue'

const props = defineProps(['token'])
const emit = defineEmits(['refresh'])

const importLoading = ref(false)
const showImportModal = ref(false)
const showExportModal = ref(false)
const importData = ref(null)
const fileInput = ref(null)
const successMessage = ref('')
const errorMessage = ref('')
const exportLoading = ref(false)

const openExportModal = () => {
  showExportModal.value = true
}

const executeExport = async () => {
  exportLoading.value = true
  errorMessage.value = ''
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
      showExportModal.value = false
      showSuccess('导出成功！文件已开始下载。')
    } else {
      errorMessage.value = '导出失败: ' + data.message
    }
  } catch (e) {
    errorMessage.value = '导出出错: ' + e.message
  } finally {
    exportLoading.value = false
  }
}

const triggerImport = () => {
  fileInput.value.click()
}

const showSuccess = (msg) => {
  successMessage.value = msg
  setTimeout(() => {
    successMessage.value = ''
  }, 3000)
}

const handleFileChange = (event) => {
  const file = event.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result)

      // Check for LeanCloud format (Array)
      if (Array.isArray(json)) {
        const counters = {}
        let validCount = 0

        json.forEach(item => {
          if (item.target && typeof item.time === 'number') {
            counters[item.target] = {
              time: item.time,
              created_at: item.createdAt ? new Date(item.createdAt).getTime() : Date.now(),
              updated_at: item.updatedAt ? new Date(item.updatedAt).getTime() : Date.now()
            }
            validCount++
          }
        })

        if (validCount === 0) {
          throw new Error('无法识别的 LeanCloud 导出格式：未找到有效的计数器数据')
        }

        importData.value = {
          counters,
          allowedDomains: []
        }
      } else {
        if (!json.counters || !json.allowedDomains) {
          throw new Error('无效的备份文件格式：缺少必要字段')
        }
        importData.value = json
      }

      showImportModal.value = true
    } catch (err) {
      errorMessage.value = '解析文件失败: ' + err.message
      setTimeout(() => {
        errorMessage.value = ''
      }, 3000)
    }
    // Reset input to allow selecting same file again
    event.target.value = ''
  }
  reader.readAsText(file)
}

const closeImportModal = () => {
  showImportModal.value = false
  importData.value = null
}

const executeImport = async () => {
  importLoading.value = true
  errorMessage.value = ''
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
      showSuccess(`导入成功！共恢复 ${data.data.imported} 个计数器。`)
      closeImportModal()
      emit('refresh')
    } else {
      errorMessage.value = '导入失败: ' + data.message
    }
  } catch (e) {
    errorMessage.value = '导入出错: ' + e.message
  } finally {
    importLoading.value = false
  }
}
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <h3 class="text-base font-semibold text-white mb-1">数据备份</h3>
    <p class="text-xs text-gray-500 mb-3">导出数据或从备份恢复（支持 OpenKounter 备份及 LeanCloud 导出数据）</p>
    
    <div class="flex gap-2 mb-2">
      <button 
        @click="openExportModal" 
        class="flex-1 py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        导出
      </button>
      
      <input 
        type="file" 
        ref="fileInput" 
        accept=".json" 
        class="hidden" 
        @change="handleFileChange" 
      />
      <button 
        @click="triggerImport" 
        class="flex-1 py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        导入
      </button>
    </div>

    <!-- Success Message -->
    <div v-if="successMessage" class="text-xs text-green-400 text-center py-1 bg-green-500/10 rounded border border-green-500/20">
      {{ successMessage }}
    </div>

    <!-- Error Message -->
    <div v-if="errorMessage" class="text-xs text-red-400 text-center py-1 bg-red-500/10 rounded border border-red-500/20">
      {{ errorMessage }}
    </div>
  </div>

  <!-- Export Confirmation Modal -->
  <ConfirmModal
    v-model:show="showExportModal"
    title="确认导出数据"
    confirm-text="确认导出"
    :loading="exportLoading"
    @confirm="executeExport"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      您即将导出所有计数器数据。
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p>此操作将生成包含所有计数器数据的 JSON 文件。</p>
      <p class="mt-1 text-yellow-500/80">注意：导出操作需要遍历所有数据，可能会占用较多的 KV 读写额度。</p>
    </div>
  </ConfirmModal>

  <!-- Import Confirmation Modal -->
  <ConfirmModal
    v-model:show="showImportModal"
    title="危险操作确认"
    variant="danger"
    confirm-text="确认覆盖导入"
    require-confirm-input="我确认覆盖全部数据"
    :loading="importLoading"
    @confirm="executeImport"
    @cancel="closeImportModal"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      您正在尝试导入数据。此操作将 <span class="text-red-400 font-bold">永久覆盖并删除</span> 当前所有的计数器和配置数据。
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p>包含计数器：<span class="text-white">{{ importData ? Object.keys(importData.counters).length : 0 }}</span> 个</p>
      <p>包含配置项：<span class="text-white">{{ importData ? (importData.allowedDomains || []).length : 0 }}</span> 个</p>
    </div>
  </ConfirmModal>
</template>
