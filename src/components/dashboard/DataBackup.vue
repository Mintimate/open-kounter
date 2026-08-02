<script setup>
import { ref } from 'vue'

import { useI18n } from 'vue-i18n'

import ConfirmModal from '../common/ConfirmModal.vue'

const props = defineProps(['token'])
const emit = defineEmits(['refresh'])
const { t } = useI18n()

const importLoading = ref(false)
const showImportModal = ref(false)
const showExportModal = ref(false)
const importData = ref(null)
const fileInput = ref(null)
const successMessage = ref('')
const errorMessage = ref('')
const exportLoading = ref(false)
const migrateLoading = ref(false)
const showMigrateModal = ref(false)

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
      showSuccess(t('backup.exportSuccess'))
    } else {
      errorMessage.value = t('backup.exportFailed', { message: data.message })
    }
  } catch (e) {
    errorMessage.value = t('backup.exportError', { message: e.message })
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

const openMigrateModal = () => {
  showMigrateModal.value = true
}

const executeLegacyMigration = async () => {
  migrateLoading.value = true
  errorMessage.value = ''

  try {
    const legacyRes = await fetch('/legacy-api/migrate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'export_all',
        token: props.token
      })
    })
    const legacyData = await legacyRes.json()
    if (legacyData.code !== 0) {
      throw new Error(legacyData.message || t('login.legacyExportFailed'))
    }

    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'migrate_legacy',
        legacyBundle: legacyData.data
      })
    })

    const data = await res.json()
    if (data.code === 0) {
      showMigrateModal.value = false
      showSuccess(t('backup.migrateSuccess', { count: data.data.importedCounters }))
      emit('refresh')
    } else {
      errorMessage.value = t('backup.migrateFailed', { message: data.message })
    }
  } catch (e) {
    errorMessage.value = t('backup.migrateError', { message: e.message })
  } finally {
    migrateLoading.value = false
  }
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
          throw new Error(t('backup.invalidLeanCloud'))
        }

        importData.value = {
          counters,
          allowedDomains: []
        }
      } else {
        if (!json.counters || !json.allowedDomains) {
          throw new Error(t('backup.invalidBackup'))
        }
        importData.value = json
      }

      showImportModal.value = true
    } catch (err) {
      errorMessage.value = t('backup.parseFailed', { message: err.message })
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
      showSuccess(t('backup.importSuccess', { count: data.data.imported }))
      closeImportModal()
      emit('refresh')
    } else {
      errorMessage.value = t('backup.importFailed', { message: data.message })
    }
  } catch (e) {
    errorMessage.value = t('backup.importError', { message: e.message })
  } finally {
    importLoading.value = false
  }
}
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <h3 class="text-base font-semibold text-white mb-1">{{ t('backup.title') }}</h3>
    <p class="text-xs text-gray-500 mb-3">{{ t('backup.description') }}</p>
    
    <div class="flex gap-2 mb-2">
      <button 
        @click="openExportModal" 
        class="button-secondary button-compact flex-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        {{ t('backup.export') }}
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
        class="button-secondary button-compact flex-1"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        {{ t('backup.import') }}
      </button>
    </div>

    <button
      @click="openMigrateModal"
      class="button-success-outline button-compact w-full"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7h16M4 12h16M4 17h10" />
      </svg>
      {{ t('backup.migrate') }}
    </button>

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
    :title="t('backup.exportTitle')"
    :confirm-text="t('backup.exportConfirm')"
    :loading="exportLoading"
    @confirm="executeExport"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      {{ t('backup.exportDescription') }}
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p>{{ t('backup.exportHint') }}</p>
      <p class="mt-1 text-yellow-500/80">{{ t('backup.exportWarning') }}</p>
    </div>
  </ConfirmModal>

  <!-- Import Confirmation Modal -->
  <ConfirmModal
    v-model:show="showImportModal"
    :title="t('backup.dangerousTitle')"
    variant="danger"
    :confirm-text="t('backup.importConfirm')"
    :require-confirm-input="t('backup.importPhrase')"
    :loading="importLoading"
    @confirm="executeImport"
    @cancel="closeImportModal"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      {{ t('backup.importDescriptionBefore') }} <span class="text-red-400 font-bold">{{ t('backup.importDestructive') }}</span> {{ t('backup.importDescriptionAfter') }}
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p>{{ t('backup.counterCount', { count: importData ? Object.keys(importData.counters).length : 0 }) }}</p>
      <p>{{ t('backup.configCount', { count: importData ? (importData.allowedDomains || []).length : 0 }) }}</p>
    </div>
  </ConfirmModal>

  <ConfirmModal
    v-model:show="showMigrateModal"
    :title="t('backup.migrateTitle')"
    :confirm-text="t('backup.migrateConfirm')"
    :loading="migrateLoading"
    @confirm="executeLegacyMigration"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      {{ t('backup.migrateDescription') }}
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p>{{ t('backup.migrateHint') }}</p>
      <p class="mt-1 text-yellow-500/80">{{ t('backup.migrateWarning') }}</p>
    </div>
  </ConfirmModal>
</template>
