<script setup lang="ts">
// Marco del panel del local: barra superior con avisos y pestañas inferiores.
const api = useApi();
const { me, logout } = useSession();
const { dateTime } = useDates();
const route = useRoute();

const notes = ref<{ items: any[]; unread: number }>({ items: [], unread: 0 });
const waiting = ref(0);
const showNotes = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    const [n, convs] = await Promise.all([api('/notifications'), api<any[]>('/conversations')]);
    notes.value = n;
    waiting.value = convs.filter((c) => c.humanTakeover).length;
  } catch {
    /* sin conexión: se reintenta en el siguiente ciclo */
  }
}
async function openNotes() {
  showNotes.value = true;
  if (notes.value.unread) {
    await api('/notifications/read-all', { method: 'POST' });
    notes.value.unread = 0;
  }
}
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 30_000);
});
onUnmounted(() => clearInterval(timer));
watch(() => route.path, refresh);

const ICONS: Record<string, string> = {
  BOOKED: '📅', CANCELLED: '❌', RESCHEDULED: '🔁', CONFIRMED: '✅', NO_CONFIRMATION: '⏰', HUMAN_REQUEST: '🙋', WAITLIST_BOOKED: '🎉', MESSAGE: '💬',
};
const sub = computed(() => me.value?.subscription);
const REASONS: Record<string, string> = {
  SUSPENDED: 'Tu cuenta está suspendida. El bot no está atendiendo a tus clientes. Comunícate con el administrador.',
  TRIAL_EXPIRED: 'Tu período de prueba terminó. El bot no está atendiendo a tus clientes.',
  EXPIRED: 'Tu suscripción venció. El bot no está atendiendo a tus clientes.',
  NO_SUBSCRIPTION: 'No tienes una suscripción activa. El bot no está atendiendo a tus clientes.',
};
</script>

<template>
  <div>
    <header class="topbar">
      <div class="inner row">
        <div class="grow">
          <h1 class="ellipsis">{{ me?.tenant?.name }}</h1>
        </div>
        <button class="iconbtn" aria-label="Avisos" @click="openNotes">
          🔔<span v-if="notes.unread" class="badge">{{ notes.unread > 99 ? '99+' : notes.unread }}</span>
        </button>
      </div>
    </header>

    <main class="page">
      <div v-if="sub && !sub.serviceable" class="banner" role="alert">{{ REASONS[sub.reason] }}</div>
      <slot />
    </main>

    <nav class="tabbar" aria-label="Secciones">
      <NuxtLink to="/"><span class="ico">📅</span>Agenda</NuxtLink>
      <NuxtLink to="/chats">
        <span class="ico">💬</span>Chats<span v-if="waiting" class="badge" style="right: 26%">{{ waiting }}</span>
      </NuxtLink>
      <NuxtLink to="/clientes"><span class="ico">👥</span>Clientes</NuxtLink>
      <NuxtLink to="/catalogo"><span class="ico">✂️</span>Catálogo</NuxtLink>
      <NuxtLink to="/mas"><span class="ico">☰</span>Más</NuxtLink>
    </nav>

    <AppSheet v-if="showNotes" title="Avisos" @close="showNotes = false">
      <p v-if="!notes.items.length" class="empty">Aún no hay avisos.</p>
      <div v-for="n in notes.items" :key="n.id" class="card">
        <div class="row">
          <span>{{ ICONS[n.type] ?? '•' }}</span>
          <strong class="grow">{{ n.title }}</strong>
        </div>
        <p class="small" style="margin: 0.2rem 0 0">{{ n.body }}</p>
        <p class="muted small" style="margin: 0">{{ dateTime(n.createdAt) }}</p>
      </div>
      <button class="btn block ghost" style="margin-top: 0.75rem" @click="logout">Cerrar sesión</button>
    </AppSheet>
  </div>
</template>
