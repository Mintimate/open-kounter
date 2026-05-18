<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const isHovering = ref(false)

const goHome = () => {
  router.push('/')
}

// 随机选择一个可爱的表情
const cuteFaces = ['(◕‿◕)', '(｡♥‿♥｡)', '(◠‿◠)', '(≧◡≦)', '(•‿•)']
const currentFace = ref(cuteFaces[0])

onMounted(() => {
  currentFace.value = cuteFaces[Math.floor(Math.random() * cuteFaces.length)]
})
</script>

<template>
  <div class="flex items-center justify-center min-h-[calc(100vh-16rem)] px-4">
    <div class="relative w-full max-w-2xl mx-auto text-center">
      <!-- 背景光晕效果 -->
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-primary/20 rounded-full blur-[100px] pointer-events-none"></div>

      <!-- 主要内容卡片 -->
      <div class="relative z-10 bg-dark-800/50 backdrop-blur-xl border border-dark-700/50 rounded-3xl p-12 shadow-2xl overflow-hidden group">
        
        <!-- 装饰性背景纹理 -->
        <div class="absolute inset-0 opacity-20 dot-pattern"></div>

        <!-- 404 大字 -->
        <div class="relative mb-8">
          <h1 class="text-[8rem] md:text-[10rem] font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white/90 to-white/10 leading-none select-none drop-shadow-2xl">
            404
          </h1>
          <!-- 悬浮的星球装饰 -->
          <div class="absolute top-4 right-[20%] text-4xl animate-float opacity-80 filter drop-shadow-lg">🪐</div>
          <div class="absolute bottom-8 left-[20%] text-2xl animate-float delay-700 opacity-60">✨</div>
          
          <!-- 故障风效果文字 -->
          <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none">
            <h1 class="text-[8rem] md:text-[10rem] font-black tracking-tighter text-primary/50 translate-x-1">404</h1>
          </div>
        </div>

        <!-- 可爱的角色互动区 -->
        <div 
          class="relative inline-block mb-10 cursor-pointer"
          @mouseenter="isHovering = true"
          @mouseleave="isHovering = false"
          @click="goHome"
        >
          <div class="relative z-10 px-6 py-3 bg-dark-700/50 rounded-2xl border border-dark-600/50 transition-all duration-300 hover:border-primary/50 hover:shadow-[0_0_30px_-5px_theme('colors.primary.DEFAULT')] hover:bg-dark-700/80">
            <div class="text-6xl md:text-7xl font-mono text-gray-200 transition-transform duration-300" :class="{ 'animate-wiggle': isHovering }">
              {{ isHovering ? '(◕ᴗ◕✿)' : currentFace }}
            </div>
          </div>
          <div class="absolute -top-2 -right-2 w-3 h-3 bg-red-500 rounded-full animate-ping"></div>
          
          <!-- 气泡提示 -->
          <transition 
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="transform scale-95 opacity-0 translate-y-2"
            enter-to-class="transform scale-100 opacity-100 translate-y-0"
            leave-active-class="transition duration-150 ease-in"
            leave-from-class="transform scale-100 opacity-100 translate-y-0"
            leave-to-class="transform scale-95 opacity-0 translate-y-2"
          >
            <div v-if="isHovering" class="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-primary text-white text-xs rounded-lg whitespace-nowrap shadow-lg">
              带我回家 🚀
              <div class="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border-4 border-transparent border-t-primary"></div>
            </div>
          </transition>
        </div>

        <!-- 文本区域 -->
        <div class="space-y-4 mb-10">
          <h2 class="text-2xl md:text-3xl font-bold text-gray-100">
            信号丢失...
          </h2>
          <p class="text-gray-400 max-w-md mx-auto">
            您寻找的页面似乎漂流到了未知的星系。
            <br>
            不要担心，我们随时可以返航。
          </p>
        </div>

        <!-- 操作按钮 -->
        <button
          @click="goHome"
          class="group relative inline-flex items-center justify-center px-8 py-3 bg-primary text-white font-semibold rounded-xl overflow-hidden transition-all duration-300 hover:scale-105 hover:shadow-[0_0_20px_theme('colors.primary.DEFAULT')]"
        >
          <div class="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-200%] group-hover:animate-shimmer"></div>
          <span class="mr-2 transform transition-transform group-hover:-translate-x-1">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </span>
          <span>返回控制台</span>
        </button>
      </div>

      <!-- 底部版权或装饰 -->
      <div class="mt-8 text-dark-600 text-sm font-mono">
        HTTP STATUS CODE: 404 NOT_FOUND
      </div>
    </div>
  </div>
</template>

<style scoped>
.dot-pattern {
  background-image: radial-gradient(var(--color-primary) 1px, transparent 1px);
  background-size: 16px 16px;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes wiggle {
  0%, 100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-5deg);
  }
  75% {
    transform: rotate(5deg);
  }
}

@keyframes shimmer {
  100% {
    transform: translateX(200%);
  }
}

.animate-float {
  animation: float 6s ease-in-out infinite;
}

.animate-wiggle {
  animation: wiggle 0.5s ease-in-out infinite;
}

.animate-shimmer {
  animation: shimmer 1.5s infinite;
}

.delay-700 {
  animation-delay: 0.7s;
}
</style>
