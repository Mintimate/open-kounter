<script setup>
import { nextTick, ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

const options = [
  { value: 'light', label: '亮色' },
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: '暗色' }
]

const optionButtons = ref([])

const selectOption = (value) => {
  emit('update:modelValue', value)
}

const handleKeydown = async (event, currentIndex) => {
  const lastIndex = options.length - 1
  let nextIndex = currentIndex

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = lastIndex
  } else {
    return
  }

  event.preventDefault()
  selectOption(options[nextIndex].value)
  await nextTick()
  optionButtons.value[nextIndex]?.focus()
}
</script>

<template>
  <div
    class="inline-flex h-8 items-center gap-0.5 rounded-md border border-control-border bg-control px-0.5 shadow-lg shadow-dark-900/10 backdrop-blur-xl"
    role="radiogroup"
    aria-label="界面主题"
  >
    <button
      v-for="option in options"
      :key="option.value"
      ref="optionButtons"
      type="button"
      class="flex h-7 w-7 items-center justify-center rounded transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      :class="props.modelValue === option.value
        ? 'bg-primary/10 text-primary shadow-sm'
        : 'text-gray-500 hover:bg-control-hover hover:text-gray-200'"
      :aria-checked="props.modelValue === option.value"
      :aria-label="option.label"
      :title="option.label"
      :tabindex="props.modelValue === option.value ? 0 : -1"
      role="radio"
      @click="selectOption(option.value)"
      @keydown="handleKeydown($event, options.indexOf(option))"
    >
      <svg v-if="option.value === 'light'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M12 3V2m0 20v-1m9-9h1M2 12h1m15.36-6.36.7-.7M4.94 19.06l.7-.7m12.72 0 .7.7M4.94 4.94l.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
      <svg v-else-if="option.value === 'system'" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 5h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zm5 16h6m-3-4v4" />
      </svg>
      <svg v-else class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M20.35 15.35A9 9 0 018.65 3.65a9 9 0 1011.7 11.7z" />
      </svg>
    </button>
  </div>
</template>
