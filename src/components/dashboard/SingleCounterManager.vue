<script setup>
import { ref } from 'vue'

import { useI18n } from 'vue-i18n'

import ConfirmModal from '../common/ConfirmModal.vue'

const props = defineProps(['token'])
const emit = defineEmits(['refresh'])
const { t } = useI18n()

const target = ref('')
const value = ref('')
const result = ref(null)
const singleError = ref('')
const singleLoading = ref(false)

const showDeleteModal = ref(false)
const deleteLoading = ref(false)

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
      if (action !== 'get') {
        emit('refresh')
      }
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
  if (value.value === '' || value.value === null) {
    singleError.value = t('singleCounter.invalidValue')
    return
  }
  callApi('set', { value: parseInt(value.value) })
}

const handleDelete = () => {
  if (!target.value) return
  showDeleteModal.value = true
}

const confirmDelete = async () => {
  deleteLoading.value = true
  try {
    await callApi('delete')
  } finally {
    deleteLoading.value = false
    showDeleteModal.value = false
  }
}
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <h3 class="text-base font-semibold text-white mb-1">{{ t('singleCounter.title') }}</h3>
    <p class="text-xs text-gray-500 mb-3">{{ t('singleCounter.description') }}</p>
    
    <div class="space-y-2">
      <div>
        <div class="flex flex-col sm:flex-row gap-2">
          <input 
            v-model="target" 
            placeholder="Target Key" 
            class="form-control field-compact min-w-0 flex-1"
          />
          <button 
            @click="handleGet" 
            :disabled="singleLoading" 
            class="button-primary button-compact w-full min-w-16 shrink-0 whitespace-nowrap sm:w-auto"
          >
            {{ t('singleCounter.query') }}
          </button>
        </div>
      </div>

      <div v-if="result || target" class="pt-2 border-t border-dark-700">
        <div class="flex flex-col sm:flex-row gap-2">
          <input 
            type="number" 
            v-model="value" 
            placeholder="Value"
            class="form-control field-compact min-w-0 flex-1"
          />
          <button 
            @click="handleSet" 
            :disabled="singleLoading" 
            class="button-warning button-compact w-full min-w-16 shrink-0 whitespace-nowrap sm:w-auto"
          >
            {{ t('common.update') }}
          </button>
        </div>
      </div>

      <div v-if="target" class="pt-2 border-t border-dark-700">
        <button 
          @click="handleDelete" 
          :disabled="singleLoading" 
          class="button-danger button-compact w-full"
        >
          {{ t('singleCounter.deleteButton') }}
        </button>
      </div>

      <div v-if="result" class="mt-2 bg-dark-900 rounded-lg border border-dark-700 overflow-hidden text-left">
        <div v-for="(val, key) in result" :key="key" class="flex px-3 py-2 border-b border-dark-800 last:border-0">
          <span class="text-xs text-gray-500 w-24 shrink-0 font-medium truncate" :title="key">{{ key }}</span>
          <span class="text-xs text-green-400 font-mono break-all">{{ typeof val === 'object' ? JSON.stringify(val) : val }}</span>
        </div>
      </div>

      <div v-if="singleError" class="text-xs text-danger mt-1">{{ singleError }}</div>
    </div>

    <ConfirmModal
      :show="showDeleteModal"
      :title="t('counterList.deleteTitle')"
      variant="danger"
      :loading="deleteLoading"
      :confirm-text="t('counterList.deleteConfirm')"
      @confirm="confirmDelete"
      @cancel="showDeleteModal = false"
      @update:show="showDeleteModal = $event"
    >
      <i18n-t keypath="counterList.deleteDescription" tag="p" class="text-sm text-gray-400">
        <template #target><span class="font-mono text-primary">{{ target }}</span></template>
      </i18n-t>
    </ConfirmModal>
  </div>
</template>
