<script setup>
import { onMounted, ref } from 'vue'

const emit = defineEmits(['login'])

const tokenInput = ref('')
const isInitialized = ref(true)
const loading = ref(false)
const message = ref('')
const username = ref('admin')

const checkInitStatus = async () => {
  try {
    // Try to auth with a dummy token to check if system is initialized
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'check_init' })
    })
    const data = await res.json()
    // Check if system is not initialized
    if (data.code !== 0 && data.message === 'Not initialized') {
      isInitialized.value = false
    } else {
      isInitialized.value = true
    }
  } catch (e) {
    console.error(e)
    // On error, assume not initialized to be safe
    isInitialized.value = false
  }
}

onMounted(() => {
  checkInitStatus()
})

const handleSubmit = async () => {
  if (!tokenInput.value) return
  loading.value = true
  message.value = ''

  try {
    if (!isInitialized.value) {
      // Initialize
      const res = await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.value })
      })
      const data = await res.json()
      if (data.code === 0) {
        message.value = '初始化成功！正在登录...'
        emit('login', tokenInput.value)
      } else {
        message.value = data.message
      }
    } else {
      // Login
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.value })
      })
      const data = await res.json()
      if (data.code === 0) {
        emit('login', tokenInput.value)
      } else {
        message.value = data.message
      }
    }
  } catch (e) {
    message.value = e.message
  } finally {
    loading.value = false
  }
}

// Passkey 登录
const handlePasskeyLogin = async () => {
  loading.value = true
  message.value = ''

  try {
    // 1. 生成认证选项
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
        allowCredentials: options.allowCredentials.map(cred => ({
          ...cred,
          id: base64URLDecode(cred.id)
        }))
      }
    })
    
    // 3. 验证认证
    const verifyRes = await fetch('/api/passkey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'verifyAuthentication',
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
    
    const verifyData = await verifyRes.json()
    
    if (verifyData.code === 0) {
      message.value = 'Passkey 登录成功！'
      emit('login', verifyData.data.token)
    } else {
      throw new Error(verifyData.message)
    }
  } catch (e) {
    console.error('Passkey login error:', e)
    message.value = `Passkey 登录失败: ${e.message}`
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
  <div class="w-full max-w-md">
    <!-- Logo/Brand Section -->
    <div class="text-center mb-10">
      <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-purple-600 shadow-lg shadow-primary/30 mb-6 transform hover:scale-105 transition-transform duration-300 overflow-hidden">
        <img src="/favicon.png" alt="Logo" class="w-10 h-10 object-contain" />
      </div>
      <h2 class="text-3xl font-bold text-white tracking-tight mb-2">
        {{ isInitialized ? '欢迎回来' : '系统初始化' }}
      </h2>
      <p class="text-gray-400">
        {{ isInitialized ? '请使用管理员 Token 登录' : '初次使用请设置管理员 Token' }}
      </p>
    </div>

    <!-- Card -->
    <div class="bg-dark-800/50 backdrop-blur-xl rounded-2xl shadow-2xl border border-dark-700/50 p-8 relative overflow-hidden group">
      <!-- Decorative gradient blob -->
      <div class="absolute -top-24 -right-24 w-48 h-48 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-colors duration-500"></div>
      
      <div class="relative space-y-6">
        <div class="space-y-2">
          <label class="text-sm font-medium text-gray-300 ml-1">管理员 Token</label>
          <div class="relative">
            <div class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <input 
              type="password" 
              v-model="tokenInput" 
              placeholder="请输入您的访问令牌" 
              @keyup.enter="handleSubmit" 
              class="w-full pl-11 pr-4 py-3.5 bg-dark-900/50 border border-dark-600 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200 hover:border-dark-500"
            />
          </div>
        </div>
        
        <button 
          @click="handleSubmit" 
          :disabled="loading"
          class="w-full py-3.5 bg-gradient-to-r from-primary to-purple-600 hover:from-primary-hover hover:to-purple-500 text-white font-bold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transform hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none flex items-center justify-center gap-2"
        >
          <svg v-if="loading" class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>{{ loading ? '验证中...' : (isInitialized ? '立即登录' : '设置并登录') }}</span>
          <svg v-if="!loading" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </button>

        <!-- Passkey 登录 -->
        <div v-if="isInitialized" class="relative">
          <div class="absolute inset-0 flex items-center">
            <div class="w-full border-t border-dark-600"></div>
          </div>
          <div class="relative flex justify-center text-xs uppercase">
            <span class="bg-dark-800 px-2 text-gray-500">或</span>
          </div>
        </div>

        <button 
          v-if="isInitialized"
          @click="handlePasskeyLogin" 
          :disabled="loading"
          class="w-full py-3.5 bg-dark-700/50 hover:bg-dark-700 border border-dark-600 hover:border-green-500/50 text-white font-medium rounded-xl shadow-lg hover:shadow-green-500/20 transform hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span>使用 Passkey 登录</span>
        </button>
        
        <div 
          v-if="message"
          class="p-4 rounded-xl text-sm text-center flex items-center justify-center gap-2 animate-fade-in"
          :class="message.includes('成功') ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'"
        >
          <svg v-if="message.includes('成功')" xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {{ message }}
        </div>
      </div>
    </div>
    
    <div class="mt-8 text-center">
      <p class="text-xs text-gray-600">
        &copy; {{ new Date().getFullYear() }} Open Kounter. All rights reserved.
      </p>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
