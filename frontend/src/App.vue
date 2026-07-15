<script setup>
import { darkTheme } from 'naive-ui'
import AppShell from '@/components/AppShell.vue'
import { themeOverrides } from '@/ui/theme'
</script>

<template>
  <NConfigProvider abstract :theme="darkTheme" :theme-overrides="themeOverrides">
    <NGlobalStyle />
    <AppShell />
  </NConfigProvider>
</template>
