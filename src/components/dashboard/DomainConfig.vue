<script setup>
import { onMounted, ref } from 'vue'

import { useI18n } from 'vue-i18n'

const props = defineProps(['token'])
const { t } = useI18n()

const allowedDomains = ref([])
const newDomain = ref('')
const configLoading = ref(false)
const configError = ref('')
const configSuccess = ref('')

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
  configSuccess.value = ''

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
      configSuccess.value = t('domain.saved')
      setTimeout(() => {
        configSuccess.value = ''
      }, 2000)
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
    <h3 class="text-base font-semibold text-white mb-1">{{ t('domain.title') }}</h3>
    <p class="text-xs text-gray-500 mb-3">{{ t('domain.description') }}</p>
    
    <div class="mb-3 rounded-md border border-primary/20 bg-primary/10 px-3 py-2">
      <p class="text-xs leading-relaxed text-primary">
        {{ t('domain.emptyHint') }}
      </p>
    </div>

    <div class="space-y-3">
      <div class="flex flex-col sm:flex-row gap-2">
        <input 
          v-model="newDomain" 
          placeholder="https://example.com"
          @keyup.enter="addDomain"
          class="form-control field-compact min-w-0 flex-1"
        />
        <button 
          @click="addDomain" 
          :disabled="configLoading" 
          class="button-success button-compact w-full min-w-16 shrink-0 sm:w-auto"
        >
          {{ t('common.add') }}
        </button>
      </div>

      <div class="space-y-2 max-h-32 overflow-y-auto pr-1">
        <div v-for="(domain, index) in allowedDomains" :key="index" class="group flex items-center justify-between rounded-lg border border-field-border bg-field p-1.5">
          <span class="text-xs font-mono text-gray-300 truncate">{{ domain }}</span>
          <button
            type="button"
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30"
            :aria-label="t('domain.remove', { domain })"
            :title="t('domain.remove', { domain })"
            @click="removeDomain(index)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
            </svg>
          </button>
        </div>
        <div v-if="allowedDomains.length === 0" class="text-center py-2 text-xs text-gray-600">
          {{ t('domain.allAllowed') }}
        </div>
      </div>

      <button 
        @click="saveConfig" 
        :disabled="configLoading" 
        class="button-secondary button-compact mt-1 w-full"
      >
        {{ configLoading ? t('common.saving') : t('domain.save') }}
      </button>

      <div v-if="configSuccess" class="text-xs text-success mt-1">{{ configSuccess }}</div>
      <div v-if="configError" class="text-xs text-danger mt-1">{{ configError }}</div>
    </div>
  </div>
</template>
