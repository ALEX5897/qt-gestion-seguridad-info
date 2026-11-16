<script setup lang="ts">
// Conversaciones de WhatsApp: ver lo que respondió el bot y atender en persona.
const api = useApi();
const { dateTime, time } = useDates();

const convs = ref<any[]>([]);
const loading = ref(true);
const current = ref<any | null>(null);
const messages = ref<any[]>([]);
const text = ref('');
const busy = ref(false);
const error = ref('');
const thread = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;

async function load() {
  convs.value = await api('/conversations');
  loading.value = false;
  if (current.value) {
    current.value = convs.value.find((c) => c.customer.id === current.value.customer.id) ?? current.value;
    await loadMessages();
  }
}
async function loadMessages() {
  const before = messages.value.length;
  messages.value = await api(`/conversations/${current.value.customer.id}/messages`);
  if (messages.value.length !== before) nextTick(() => thread.value?.scrollTo({ top: thread.value.scrollHeight }));
}
async function open(c: any) {
  current.value = c;
  messages.value = [];
  error.value = '';
  await loadMessages();
}
async function send() {
  if (!text.value.trim()) return;
  busy.value = true;
  error.value = '';
  try {
    const { ok } = await api(`/conversations/${current.value.customer.id}/messages`, { method: 'POST', body: { text: text.value.trim() } });
    if (!ok) error.value = 'WhatsApp no aceptó el mensaje. Si pasaron más de 24 h desde el último mensaje del cliente, solo se pueden enviar plantillas.';
    text.value = '';
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function toggle(take: boolean) {
  await api(`/conversations/${current.value.customer.id}/${take ? 'takeover' : 'release'}`, { method: 'POST' });
  await load();
}
onMounted(() => {
  load();
  timer = setInterval(load, 10_000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div>
    <p v-if="loading" class="empty">Cargando…</p>
    <p v-else-if="!convs.length" class="empty">Aún no hay conversaciones. Aparecerán aquí cuando tus clientes escriban al WhatsApp del local.</p>
    <button v-for="c in convs" :key="c.id" class="card" @click="open(c)">
      <div class="row">
        <div class="grow">
          <strong>{{ c.customer.name || '+' + c.customer.phone }}</strong>
          <div class="muted small">{{ dateTime(c.lastMessageAt) }}</div>
        </div>
        <span v-if="c.humanTakeover" class="chip warn">Espera tu respuesta</span>
        <span v-else class="chip">Bot</span>
      </div>
    </button>

    <AppSheet v-if="current" :title="current.customer.name || '+' + current.customer.phone" @close="current = null">
      <div class="row wrap" style="margin-bottom: 0.6rem">
        <span v-if="current.humanTakeover" class="chip warn">El bot está en pausa</span>
        <span v-else class="chip ok">Atiende el bot</span>
        <button v-if="current.humanTakeover" class="btn sm right" @click="toggle(false)">Devolver al bot</button>
        <button v-else class="btn sm right" @click="toggle(true)">Atender yo</button>
      </div>
      <div ref="thread" style="max-height: 46vh; overflow: auto; padding: 0.25rem 0">
        <div v-for="m in messages" :key="m.id" class="bubble" :class="{ out: m.direction === 'OUT' }">
          <span v-if="m.pressed" class="muted small">Pulsó: </span>{{ m.text }}
          <div v-if="m.options.length" class="opts">
            <span v-for="o in m.options" :key="o" class="chip">{{ o }}</span>
          </div>
          <div class="muted" style="font-size: 0.7rem; text-align: right">{{ time(m.at) }}</div>
        </div>
      </div>
      <p v-if="error" class="error" role="alert" style="margin-top: 0.5rem">{{ error }}</p>
      <form class="row" style="margin-top: 0.6rem" @submit.prevent="send">
        <input v-model="text" aria-label="Mensaje" placeholder="Escribe un mensaje…" maxlength="1000" />
        <button class="btn primary" :disabled="busy || !text.trim()">Enviar</button>
      </form>
      <p class="muted small" style="margin-top: 0.4rem">Al responder, el bot queda en pausa para este cliente hasta que lo devuelvas.</p>
    </AppSheet>
  </div>
</template>
