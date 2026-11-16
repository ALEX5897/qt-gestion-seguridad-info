<script setup lang="ts">
// Ventana inferior (móvil) o centrada (pantalla grande) para formularios y acciones.
defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="sheet" role="dialog" :aria-label="title">
      <header>
        <h2>{{ title }}</h2>
        <button class="iconbtn" aria-label="Cerrar" @click="emit('close')">✕</button>
      </header>
      <slot />
    </div>
  </div>
</template>
