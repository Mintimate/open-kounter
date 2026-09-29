<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

import ConfirmModal from '../common/ConfirmModal.vue'

import { createPasskeyCeremony } from '../../utils/passkeyCeremony.js'
import { requestJson } from '../../utils/requestJson.js'

const props = defineProps(['token'])

const loading = ref(false)
const message = ref('')
const hasPasskey = ref(false)
const credentials = ref([])
const username = ref('admin')
const newToken = ref('')
const oldToken = ref('')
const authMethod = ref('passkey') // 'passkey' | 'token'
const hasAdminToken = ref(false)
const lifecycleController = new AbortController()
let reloadTimer = null

// Modal states
const showSyncModal = ref(false)
const showUpdateModal = ref(false)

// Check if ADMIN_TOKEN is configured on the server
const checkStatus = async () => {
  try {
    const data = await requestJson('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: lifecycleController.signal,
      body: JSON.stringify({ action: 'get_status' })
    })
    if (lifecycleController.signal.aborted) return
    if (data.code === 0) {
      hasAdminToken.value = !!data.data.hasAdminToken
    }
  } catch (e) {
    if (!lifecycleController.signal.aborted) message.value = `状态检测失败: ${e.message}`
  }
}

// 检查是否已有 Passkey
const checkPasskey = async () => {
  try {
    const data = await requestJson('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: lifecycleController.signal,
      body: JSON.stringify({
        action: 'listCredentials',
        data: { username: username.value }
      })
    })
    if (lifecycleController.signal.aborted) return
    if (data.code === 0 && data.data.length > 0) {
      hasPasskey.value = true
      credentials.value = data.data
      authMethod.value = 'passkey'
    } else {
      hasPasskey.value = false
      credentials.value = []
      authMethod.value = 'token'
    }
  } catch (e) {
    if (!lifecycleController.signal.aborted) message.value = `Passkey 检测失败: ${e.message}`
  }
}

onMounted(() => {
  checkPasskey()
  checkStatus()
})

onBeforeUnmount(() => {
  lifecycleController.abort()
  clearTimeout(reloadTimer)
})

// 绑定/重新绑定 Passkey
const handleBindPasskey = async () => {
  if (loading.value || lifecycleController.signal.aborted) return
  loading.value = true
  message.value = ''
  const ceremony = createPasskeyCeremony({ signal: lifecycleController.signal })
  
  try {
    // 1. 生成注册选项
    const { options, challengeId } = await ceremony.generate('generateRegistrationOptions', {
      username: username.value,
      token: props.token
    })
    if (!ceremony.active) return
    
    // 2. 调用 WebAuthn API
    const credential = await ceremony.wait(navigator.credentials.create({
      signal: ceremony.signal,
      publicKey: {
        ...options,
        challenge: base64URLDecode(options.challenge),
        user: {
          ...options.user,
          id: base64URLDecode(options.user.id)
        }
      }
    }))
    if (!ceremony.active) return
    
    // 3. 验证注册
    const verifyData = await requestJson('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ceremony.signal,
      body: JSON.stringify({
        action: 'verifyRegistration',
        data: {
          challengeId,
          response: {
            id: credential.id,
            rawId: credential.id,
            type: credential.type,
            response: {
              clientDataJSON: base64URLEncode(credential.response.clientDataJSON),
              attestationObject: base64URLEncode(credential.response.attestationObject),
              transports: credential.response.getTransports ? credential.response.getTransports() : []
            }
          }
        }
      })
    })
    
    if (!ceremony.active) return
    
    if (verifyData.code === 0) {
      ceremony.complete()
      message.value = hasPasskey.value ? 'Passkey 重新绑定成功！' : 'Passkey 绑定成功！'
      await checkPasskey()
    } else {
      throw new Error(verifyData.message)
    }
  } catch (e) {
    if (ceremony.active && !lifecycleController.signal.aborted) message.value = `绑定失败: ${e.message}`
  } finally {
    ceremony.cancel()
    if (!lifecycleController.signal.aborted) loading.value = false
  }
}

// Sync ADMIN_TOKEN to Blob
const openSyncModal = () => {
  showSyncModal.value = true
}

const executeSyncAdminToken = async () => {
  if (loading.value || lifecycleController.signal.aborted) return
  loading.value = true
  message.value = ''

  try {
    const data = await requestJson('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: lifecycleController.signal,
      body: JSON.stringify({
        action: 'syncAdminToken',
        token: props.token
      })
    })
    if (lifecycleController.signal.aborted) return
    if (data.code === 0) {
      showSyncModal.value = false
      message.value = 'ADMIN_TOKEN 已覆盖写入 Blob！即将重新加载...'
      reloadTimer = setTimeout(() => {
        window.location.reload()
      }, 1500)
    } else {
      throw new Error(data.message)
    }
  } catch (e) {
    if (!lifecycleController.signal.aborted) message.value = `同步失败: ${e.message}`
  } finally {
    if (!lifecycleController.signal.aborted) loading.value = false
  }
}

// 通过 Passkey 或旧 Token 更新 Token
const openUpdateModal = () => {
  if (!newToken.value) return

  if (authMethod.value === 'passkey' && !hasPasskey.value) {
    message.value = '请先绑定 Passkey'
    return
  }

  if (authMethod.value === 'token' && !oldToken.value) {
    message.value = '请输入旧 Token'
    return
  }

  showUpdateModal.value = true
}

const executeUpdateToken = async () => {
  if (loading.value || lifecycleController.signal.aborted) return
  loading.value = true
  message.value = ''
  const method = authMethod.value
  const requestedToken = newToken.value
  const currentToken = oldToken.value
  const ceremony = method === 'passkey' ? createPasskeyCeremony({ signal: lifecycleController.signal }) : null

  try {
    let managementToken = null

    if (ceremony) {
      // 1. 获取认证选项
      const { options, challengeId } = await ceremony.generate('generateAuthenticationOptions', {
        username: username.value,
        purpose: 'management'
      })
      if (!ceremony.active) return

      // 2. 调用 WebAuthn API
      const credential = await ceremony.wait(navigator.credentials.get({
        signal: ceremony.signal,
        publicKey: {
          ...options,
          challenge: base64URLDecode(options.challenge),
          allowCredentials: options.allowCredentials.map(c => ({
            ...c,
            id: base64URLDecode(c.id)
          }))
        }
      }))
      if (!ceremony.active) return

      // 3. 获取 Management Token
      const tokenData = await requestJson('/api/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ceremony.signal,
        body: JSON.stringify({
          action: 'generateManagementToken',
          data: {
            challengeId,
            response: {
              id: credential.id,
              rawId: credential.id,
              type: credential.type,
              response: {
                clientDataJSON: base64URLEncode(credential.response.clientDataJSON),
                authenticatorData: base64URLEncode(credential.response.authenticatorData),
                signature: base64URLEncode(credential.response.signature),
                userHandle: credential.response.userHandle ? base64URLEncode(credential.response.userHandle) : null
              }
            }
          }
        })
      })

      if (!ceremony.active) return

      if (tokenData.code !== 0) {
        throw new Error(tokenData.message)
      }
      if (typeof tokenData.data?.managementToken !== 'string' || !tokenData.data.managementToken) {
        throw new Error('Passkey 响应格式异常')
      }

      ceremony.complete()
      managementToken = tokenData.data.managementToken
    }

    // 4. 更新 Token
    const updateBody = {
      newToken: requestedToken
    }

    if (method === 'passkey') {
      updateBody.managementToken = managementToken
    } else {
      updateBody.token = currentToken
    }

    const updateData = await requestJson('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: lifecycleController.signal,
      body: JSON.stringify(updateBody)
    })

    if (lifecycleController.signal.aborted) return

    if (updateData.code === 0) {
      showUpdateModal.value = false
      message.value = 'Token 更新成功！即将重新加载...'
      newToken.value = ''
      oldToken.value = ''
      reloadTimer = setTimeout(() => {
        window.location.reload()
      }, 1500)
    } else {
      throw new Error(updateData.message)
    }
  } catch (e) {
    if (!lifecycleController.signal.aborted && (!ceremony || ceremony.active)) {
      message.value = `更新失败: ${e.message}`
      showUpdateModal.value = false
    }
  } finally {
    ceremony?.cancel()
    if (!lifecycleController.signal.aborted) loading.value = false
  }
}

// Base64URL 编解码
function base64URLEncode(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64URLDecode(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
  const binary = atob(base64 + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm p-4">
    <div class="flex items-center justify-between mb-1">
      <h3 class="text-base font-semibold text-white">Passkey 管理</h3>
      <div v-if="hasPasskey" class="px-2 py-0.5 bg-green-500/10 border border-green-500/20 rounded text-green-400 text-xs flex items-center gap-1">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
        </svg>
        已绑定
      </div>
    </div>
    <p class="text-xs text-gray-500 mb-3">使用生物识别快速登录</p>

    <div class="space-y-2">
      <button
        @click="handleBindPasskey"
        :disabled="loading"
        class="button-secondary button-compact w-full"
      >
        <svg v-if="loading" class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>{{ loading ? '处理中...' : (hasPasskey ? '重新绑定' : '绑定 Passkey') }}</span>
      </button>

      <!-- Sync ADMIN_TOKEN to Blob -->
      <div v-if="hasAdminToken" class="border-t border-dark-700 pt-2 mt-2">
        <div class="flex items-center justify-between mb-1">
          <p class="text-xs text-gray-500">环境变量同步</p>
          <div class="px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 rounded text-amber-400 text-xs flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            ADMIN_TOKEN
          </div>
        </div>
        <p class="text-xs text-gray-600 mb-2">检测到 ADMIN_TOKEN 环境变量，可将其覆盖写入 Blob 主存储</p>
        <button
          @click="openSyncModal"
          :disabled="loading"
          class="button-warning-outline button-compact w-full"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>TOKEN 覆盖至 Blob</span>
        </button>
      </div>

      <div v-if="hasPasskey" class="border-t border-dark-700 pt-2 mt-2">
        <div class="flex items-center justify-between mb-2">
          <p class="text-xs text-gray-500">更新 Token</p>
          <div class="flex gap-2 text-xs" v-if="hasPasskey">
            <button 
              @click="authMethod = 'passkey'"
              class="px-2 py-0.5 rounded transition-colors"
              :class="authMethod === 'passkey' ? 'bg-primary-500/20 text-primary-400' : 'text-gray-500 hover:text-gray-300'"
            >Passkey</button>
            <button 
              @click="authMethod = 'token'"
              class="px-2 py-0.5 rounded transition-colors"
              :class="authMethod === 'token' ? 'bg-primary-500/20 text-primary-400' : 'text-gray-500 hover:text-gray-300'"
            >旧 Token</button>
          </div>
        </div>

        <div class="space-y-2">
          <input 
            v-if="authMethod === 'token'"
            v-model="oldToken" 
            type="password" 
            placeholder="输入旧 Token"
            class="form-control field-compact w-full"
          />
          
          <input 
            v-model="newToken" 
            type="password" 
            placeholder="输入新 Token"
            class="form-control field-compact w-full"
          />
          <button
            @click="openUpdateModal"
            :disabled="loading || !newToken || (authMethod === 'token' && !oldToken)"
            class="button-secondary button-compact w-full"
          >
            <span>{{ authMethod === 'passkey' ? '验证 Passkey 并更新' : '更新 Token' }}</span>
          </button>
        </div>
      </div>

      <div 
        v-if="message" 
        class="p-1.5 rounded text-xs text-center"
        :class="message.includes('成功') ? 'text-green-400' : 'text-red-400'"
      >
        {{ message }}
      </div>
    </div>
  </div>

  <!-- Sync ADMIN_TOKEN Modal -->
  <ConfirmModal
    v-model:show="showSyncModal"
    title="同步 ADMIN_TOKEN"
    variant="warning"
    confirm-text="确认覆盖"
    :loading="loading"
    @confirm="executeSyncAdminToken"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      确定要使用 <span class="text-amber-400 font-mono">ADMIN_TOKEN</span> 环境变量覆盖写入 Blob 主存储吗？
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p>覆盖后 Blob 中的 Token 将与 ADMIN_TOKEN 保持一致，需要重新登录。</p>
    </div>
  </ConfirmModal>

  <!-- Update Token Modal -->
  <ConfirmModal
    v-model:show="showUpdateModal"
    title="危险操作确认"
    variant="warning"
    confirm-text="确认更新"
    :loading="loading"
    @confirm="executeUpdateToken"
  >
    <p class="text-gray-400 text-sm leading-relaxed">
      您正在尝试更新 Token。此操作将 <span class="text-amber-400 font-bold">使当前 Token 失效</span>，更新后需要重新登录。
    </p>
    <div class="mt-4 p-3 bg-dark-900 rounded border border-dark-700 text-xs text-gray-400">
      <p v-if="authMethod === 'passkey'">将使用 Passkey 验证身份后更新 Token。</p>
      <p v-else>将使用旧 Token 验证身份后更新 Token。</p>
      <p class="mt-1 text-amber-500/80">注意：请确保牢记新的 Token，更新后旧 Token 将无法使用。</p>
    </div>
  </ConfirmModal>
</template>

<style scoped>
</style>
