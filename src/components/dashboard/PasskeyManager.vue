<script setup>
import { onMounted, ref } from 'vue'

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

// Check if ADMIN_TOKEN is configured on the server
const checkStatus = async () => {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_status' })
    })
    const data = await res.json()
    if (data.code === 0) {
      hasAdminToken.value = !!data.data.hasAdminToken
    }
  } catch (e) {
    console.error('Check status error:', e)
  }
}

// 检查是否已有 Passkey
const checkPasskey = async () => {
  try {
    const res = await fetch('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'listCredentials',
        data: { username: username.value }
      })
    })
    const data = await res.json()
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
    console.error('Check passkey error:', e)
  }
}

onMounted(() => {
  checkPasskey()
  checkStatus()
})

// 绑定/重新绑定 Passkey
const handleBindPasskey = async () => {
  loading.value = true
  message.value = ''
  
  try {
    // 1. 生成注册选项
    const optionsRes = await fetch('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'generateRegistrationOptions',
        data: {
          username: username.value,
          token: props.token
        }
      })
    })
    const optionsData = await optionsRes.json()
    
    if (optionsData.code !== 0) {
      throw new Error(optionsData.message)
    }
    
    const { options, challengeId } = optionsData.data
    
    // 2. 调用 WebAuthn API
    const credential = await navigator.credentials.create({
      publicKey: {
        ...options,
        challenge: base64URLDecode(options.challenge),
        user: {
          ...options.user,
          id: base64URLDecode(options.user.id)
        }
      }
    })
    
    // 3. 验证注册
    const verifyRes = await fetch('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    
    const verifyData = await verifyRes.json()
    
    if (verifyData.code === 0) {
      message.value = hasPasskey.value ? 'Passkey 重新绑定成功！' : 'Passkey 绑定成功！'
      await checkPasskey()
    } else {
      throw new Error(verifyData.message)
    }
  } catch (e) {
    console.error('Bind passkey error:', e)
    message.value = `绑定失败: ${e.message}`
  } finally {
    loading.value = false
  }
}

// Sync ADMIN_TOKEN to KV
const handleSyncAdminToken = async () => {
  if (!confirm('确定要使用 ADMIN_TOKEN 覆盖写入 KV 吗？覆盖后 KV 中的 Token 将与 ADMIN_TOKEN 保持一致，需要重新登录。')) return

  loading.value = true
  message.value = ''

  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'syncAdminToken',
        token: props.token
      })
    })
    const data = await res.json()
    if (data.code === 0) {
      message.value = 'ADMIN_TOKEN 已覆盖写入 KV！即将重新加载...'
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } else {
      throw new Error(data.message)
    }
  } catch (e) {
    console.error('Sync admin token error:', e)
    message.value = `同步失败: ${e.message}`
  } finally {
    loading.value = false
  }
}

// 通过 Passkey 或旧 Token 更新 Token
const handleUpdateToken = async () => {
  if (!newToken.value) return
  
  if (authMethod.value === 'passkey' && !hasPasskey.value) {
    message.value = '请先绑定 Passkey'
    return
  }
  
  if (authMethod.value === 'token' && !oldToken.value) {
    message.value = '请输入旧 Token'
    return
  }
  
  if (!confirm('确定要更新 Token 吗？更新后需要重新登录。')) return

  loading.value = true
  message.value = ''
  
  try {
    let managementToken = null

    if (authMethod.value === 'passkey') {
      // 1. 获取认证选项
      const optionsRes = await fetch('/api/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generateAuthenticationOptions',
          data: { username: username.value }
        })
      })
      const optionsData = await optionsRes.json()
      
      if (optionsData.code !== 0) {
        throw new Error(optionsData.message)
      }
      
      const { options, challengeId } = optionsData.data
      
      // 2. 调用 WebAuthn API
      const credential = await navigator.credentials.get({
        publicKey: {
          ...options,
          challenge: base64URLDecode(options.challenge),
          allowCredentials: options.allowCredentials.map(c => ({
            ...c,
            id: base64URLDecode(c.id)
          }))
        }
      })
      
      // 3. 获取 Management Token
      const tokenRes = await fetch('/api/passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      
      const tokenData = await tokenRes.json()
      
      if (tokenData.code !== 0) {
        throw new Error(tokenData.message)
      }
      
      managementToken = tokenData.data.managementToken
    }
    
    // 4. 更新 Token
    const updateBody = {
      newToken: newToken.value
    }
    
    if (authMethod.value === 'passkey') {
      updateBody.managementToken = managementToken
    } else {
      updateBody.token = oldToken.value
    }

    const updateRes = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody)
    })
    
    const updateData = await updateRes.json()
    
    if (updateData.code === 0) {
      message.value = 'Token 更新成功！即将重新加载...'
      newToken.value = ''
      oldToken.value = ''
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } else {
      throw new Error(updateData.message)
    }
  } catch (e) {
    console.error('Update token error:', e)
    message.value = `更新失败: ${e.message}`
  } finally {
    loading.value = false
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
        class="w-full py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <svg v-if="loading" class="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>{{ loading ? '处理中...' : (hasPasskey ? '重新绑定' : '绑定 Passkey') }}</span>
      </button>

      <!-- Sync ADMIN_TOKEN to KV -->
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
        <p class="text-xs text-gray-600 mb-2">检测到 ADMIN_TOKEN 环境变量，可将其覆盖写入 KV 存储</p>
        <button
          @click="handleSyncAdminToken"
          :disabled="loading"
          class="w-full py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-sm rounded-lg transition-colors border border-amber-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span>TOKEN 覆盖至 KV</span>
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
            class="w-full px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500 transition-colors placeholder-gray-600"
          />
          
          <input 
            v-model="newToken" 
            type="password" 
            placeholder="输入新 Token"
            class="w-full px-3 py-1.5 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500 transition-colors placeholder-gray-600"
          />
          <button
            @click="handleUpdateToken"
            :disabled="loading || !newToken || (authMethod === 'token' && !oldToken)"
            class="w-full py-1.5 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
</template>

<style scoped>
</style>
