<script setup>
defineProps(['totalCount'])
</script>

<template>
  <div class="bg-dark-800 p-6 rounded-xl border border-dark-700 shadow-sm">
    <h3 class="text-gray-400 text-xs font-medium uppercase tracking-wider">总计数器</h3>
    <div class="mt-2 flex items-baseline gap-2">
      <span class="text-3xl font-bold text-white">{{ totalCount }}</span>
      <span class="text-sm text-gray-500">个</span>
    </div>
  </div>
</template>
