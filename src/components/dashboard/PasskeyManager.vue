<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps(['token'])

const loading = ref(false)
const message = ref('')
const hasPasskey = ref(false)
const credentials = ref([])
const username = ref('admin')

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
    } else {
      hasPasskey.value = false
      credentials.value = []
    }
  } catch (e) {
    console.error('Check passkey error:', e)
  }
}

onMounted(() => {
  checkPasskey()
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
