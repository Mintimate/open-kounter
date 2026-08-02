<script setup>
import { onMounted, ref } from 'vue'

import { useI18n } from 'vue-i18n'

import ConfirmModal from '../common/ConfirmModal.vue'

const props = defineProps(['token'])
const { locale, t } = useI18n()

const loading = ref(false)
const message = ref('')
const messageType = ref('error')
const oidcConfigured = ref(false)
const oidcBound = ref(false)
const boundEmail = ref('')
const boundName = ref('')
const boundAt = ref(0)

// 解绑确认弹窗
const showUnbindModal = ref(false)

const checkOidcStatus = async () => {
  try {
    const res = await fetch('/api/oidc/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_status' })
    })
    const data = await res.json()
    if (data.code === 0) {
      oidcConfigured.value = data.data.configured
      oidcBound.value = data.data.bound
      boundEmail.value = data.data.email || ''
      boundName.value = data.data.name || ''
      boundAt.value = data.data.boundAt || 0
    }
  } catch (e) {
    console.error('OIDC status check error:', e)
  }
}

onMounted(() => {
  checkOidcStatus()
})

// 发起 OIDC 绑定
const handleBind = () => {
  loading.value = true
  // 跳转到 OIDC 登录端点，携带 mode=bind 和当前 token
  const params = new URLSearchParams({
    mode: 'bind',
    token: props.token
  })
  window.location.href = `/api/oidc/login?${params.toString()}`
}

// 解绑 OIDC
const executeUnbind = async () => {
  loading.value = true
  message.value = ''

  try {
    const res = await fetch('/api/oidc/status', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({ action: 'unbind' })
    })
    const data = await res.json()
    if (data.code === 0) {
      showUnbindModal.value = false
      message.value = t('oidc.unbindSuccess')
      messageType.value = 'success'
      oidcBound.value = false
      boundEmail.value = ''
      boundName.value = ''
      boundAt.value = 0
    } else {
      throw new Error(data.message)
    }
  } catch (e) {
    console.error('OIDC unbind error:', e)
    message.value = t('oidc.unbindFailed', { message: e.message })
    messageType.value = 'error'
  } finally {
    loading.value = false
  }
}

const formatDate = (ts) => {
  if (!ts) return ''
  return new Date(ts).toLocaleString(locale.value)
}
</script>

<template>
  <!-- 仅在 OIDC 已配置时显示 -->
  <div v-if="oidcConfigured" class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <div class="flex items-center justify-between mb-1">
      <h3 class="text-base font-semibold text-white">{{ t('oidc.login') }}</h3>
      <div v-if="oidcBound" class="px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-xs flex items-center gap-1">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        {{ t('common.bound') }}
      </div>
      <div v-else class="px-2 py-0.5 bg-gray-500/10 border border-gray-500/20 rounded text-gray-400 text-xs">
        {{ t('common.notBound') }}
      </div>
    </div>
    <p class="text-xs text-gray-500 mb-3">{{ t('oidc.description') }}</p>

    <div class="space-y-2">
      <!-- 已绑定状态 -->
      <template v-if="oidcBound">
        <div class="p-2.5 bg-dark-900 rounded-lg border border-dark-700 space-y-1.5">
          <div v-if="boundName" class="flex items-center gap-2 text-xs">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span class="text-gray-300">{{ boundName }}</span>
          </div>
          <div v-if="boundEmail" class="flex items-center gap-2 text-xs">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span class="text-gray-400 font-mono">{{ boundEmail }}</span>
          </div>
          <div v-if="boundAt" class="flex items-center gap-2 text-xs">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="text-gray-500">{{ t('oidc.boundAt', { date: formatDate(boundAt) }) }}</span>
          </div>
        </div>

        <div class="flex gap-2">
          <button
            @click="handleBind"
            :disabled="loading"
            class="button-secondary button-compact flex-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{{ t('oidc.rebind') }}</span>
          </button>
          <button
            @click="showUnbindModal = true"
            :disabled="loading"
            class="button-danger button-compact px-3"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>{{ t('oidc.unbind') }}</span>
          </button>
        </div>
      </template>

      <!-- 未绑定状态 -->
      <template v-else>
        <div class="bg-blue-500/10 border-l-2 border-blue-500 p-2">
          <p class="text-xs text-blue-200 leading-relaxed">
            {{ t('oidc.bindHint') }}
          </p>
        </div>

        <button
          @click="handleBind"
          :disabled="loading"
          class="button-secondary button-compact w-full"
        >
          <svg v-if="loading" class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span>{{ loading ? t('oidc.jump') : t('oidc.bind') }}</span>
        </button>
      </template>

      <div 
        v-if="message" 
        class="p-1.5 rounded text-xs text-center"
        :class="messageType === 'success' ? 'text-green-400' : 'text-red-400'"
      >
        {{ message }}
      </div>
    </div>
  </div>

  <!-- 解绑确认弹窗 -->
  <ConfirmModal
    v-model:show="showUnbindModal"
    :title="t('oidc.unbindTitle')"
    variant="danger"
    :confirm-text="t('oidc.unbindConfirm')"
    :loading="loading"
    @confirm="executeUnbind"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      {{ t('oidc.unbindDescription') }}
    </p>
  </ConfirmModal>
</template>

<style scoped>
</style>
