<script setup lang="ts">
const { me, logout } = useSession();
</script>

<template>
  <div>
    <header class="topbar">
      <div class="inner row" style="max-width: 980px">
        <div class="grow">
          <h1>Administración de la plataforma</h1>
          <span class="muted small">{{ me?.user.name }}</span>
        </div>
        <button class="btn sm" @click="logout">Salir</button>
      </div>
    </header>
    <main class="page" style="max-width: 980px"><slot /></main>
  </div>
</template>
