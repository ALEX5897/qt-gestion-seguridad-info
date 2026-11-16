<script setup lang="ts">
// Clientes del local: buscar, ver historial, notas y bloqueo.
const api = useApi();
const { dateTime } = useDates();

const q = ref('');
const items = ref<any[]>([]);
const loading = ref(true);
const detail = ref<any | null>(null);
const busy = ref(false);
const error = ref('');
let debounce: ReturnType<typeof setTimeout> | undefined;

async function load() {
  items.value = await api(`/customers${q.value ? `?q=${encodeURIComponent(q.value)}` : ''}`);
  loading.value = false;
}
watch(q, () => {
  clearTimeout(debounce);
  debounce = setTimeout(load, 300);
});
onMounted(load);

async function open(c: any) {
  error.value = '';
  detail.value = await api(`/customers/${c.id}`);
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    const { id, name, notes, blocked } = detail.value;
    await api(`/customers/${id}`, { method: 'PATCH', body: { name: name || undefined, notes: notes ?? '', blocked } });
    detail.value = null;
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <input v-model="q" type="search" aria-label="Buscar cliente" placeholder="Buscar por nombre o teléfono" style="margin-bottom: 0.75rem" />
    <p v-if="loading" class="empty">Cargando…</p>
    <p v-else-if="!items.length" class="empty">{{ q ? 'Sin resultados.' : 'Aún no tienes clientes registrados.' }}</p>
    <button v-for="c in items" :key="c.id" class="card" @click="open(c)">
      <div class="row">
        <div class="grow">
          <strong>{{ c.name || 'Sin nombre' }}</strong>
          <div class="muted small">+{{ c.phone }} · {{ c._count.appointments }} cita(s)</div>
        </div>
        <span v-if="c.blocked" class="chip danger">Bloqueado</span>
        <span v-else-if="c.noShowCount" class="chip warn">{{ c.noShowCount }} falta(s)</span>
      </div>
    </button>

    <AppSheet v-if="detail" :title="detail.name || '+' + detail.phone" @close="detail = null">
      <form class="stack" @submit.prevent="save">
        <p class="muted">
          <a :href="`https://wa.me/${detail.phone}`" target="_blank" rel="noopener">+{{ detail.phone }}</a>
          · {{ detail.noShowCount }} falta(s)
        </p>
        <div class="field">
          <label for="cu-name">Nombre</label>
          <input id="cu-name" v-model="detail.name" maxlength="80" />
        </div>
        <div class="field">
          <label for="cu-notes">Notas (alergias, preferencias…)</label>
          <textarea id="cu-notes" v-model="detail.notes" maxlength="2000" />
        </div>
        <label class="check"><input v-model="detail.blocked" type="checkbox" /> Bloquear: el bot no le responderá</label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="btn primary block" :disabled="busy">Guardar</button>

        <h3>Historial</h3>
        <p v-if="!detail.appointments.length" class="muted small">Sin citas.</p>
        <div v-for="a in detail.appointments" :key="a.id" class="row small" style="padding: 0.3rem 0; border-top: 1px solid var(--line)">
          <span class="grow">{{ dateTime(a.startsAt) }} · {{ a.service.name }} ({{ a.professional.name }})</span>
          <span class="chip" :class="a.status">{{ STATUS_LABEL[a.status] }}</span>
        </div>
      </form>
    </AppSheet>
  </div>
</template>
