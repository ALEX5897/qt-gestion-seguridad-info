<script setup lang="ts">
definePageMeta({ layout: false });
const api = useApi();
const { setToken, loadMe, token } = useSession();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

onMounted(() => {
  if (token.value) navigateTo('/');
});

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api('/auth/login', { method: 'POST', body: { email: email.value.trim(), password: password.value } });
    setToken(res.accessToken);
    const me = await loadMe();
    await navigateTo(me.user.role === 'SUPERADMIN' ? '/admin' : '/');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page" style="max-width: 420px; padding-top: 12vh">
    <div style="text-align: center; margin-bottom: 1.5rem">
      <img src="/icon.svg" alt="" width="72" height="72" />
      <h1 style="font-size: 1.5rem; margin-top: 0.5rem">Agenda del local</h1>
      <p class="muted">Citas por WhatsApp, bajo tu control</p>
    </div>
    <form class="card stack" @submit.prevent="submit">
      <div class="field">
        <label for="email">Correo</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">Contraseña</label>
        <input id="password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button class="btn primary block" :disabled="busy">{{ busy ? 'Ingresando…' : 'Ingresar' }}</button>
    </form>
  </main>
</template>
