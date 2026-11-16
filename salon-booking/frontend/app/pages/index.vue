<script setup lang="ts">
// Agenda del día: ver citas, registrar una nueva y cambiar su estado.
const api = useApi();
const { time, isoDate, addDays, labelOf } = useDates();

const route = useRoute();
const router = useRouter();
// El día visible se guarda en la dirección (?d=) para no perderlo al recargar o compartir el enlace.
const fromQuery = typeof route.query.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(route.query.d) ? route.query.d : null;
const date = ref(fromQuery ?? isoDate());
const items = ref<any[]>([]);
const services = ref<any[]>([]);
const pros = ref<any[]>([]);
const loading = ref(true);
const error = ref('');
const showCancelled = ref(false);

const selected = ref<any | null>(null); // cita abierta
const rescheduling = ref(false);
const creating = ref(false);
const busy = ref(false);
const formError = ref('');

const form = reactive({ customerPhone: '', customerName: '', serviceId: null as number | null, professionalId: null as number | null, notes: '' });
const slot = ref<{ professionalId: number; startsAt: string } | null>(null);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    items.value = await api(`/appointments?date=${date.value}`);
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
watch(date, (d) => {
  router.replace({ query: d === isoDate() ? {} : { d } });
  load();
});
onMounted(async () => {
  load();
  [services.value, pros.value] = await Promise.all([api('/services'), api('/professionals')]);
});

const visible = computed(() => items.value.filter((a) => showCancelled.value || a.status !== 'CANCELLED'));
const cancelledCount = computed(() => items.value.filter((a) => a.status === 'CANCELLED').length);
const activeServices = computed(() => services.value.filter((s) => s.active));
/** Profesionales que realizan el servicio elegido. */
const eligiblePros = computed(() =>
  pros.value.filter((p) => p.active && (!form.serviceId || p.services.some((s: any) => s.serviceId === form.serviceId))),
);
const isActive = (a: any) => a.status === 'PENDING' || a.status === 'CONFIRMED';

function openCreate() {
  Object.assign(form, { customerPhone: '', customerName: '', serviceId: null, professionalId: null, notes: '' });
  slot.value = null;
  formError.value = '';
  creating.value = true;
}
async function create() {
  if (!slot.value) return;
  busy.value = true;
  formError.value = '';
  try {
    const created = await api('/appointments', {
      method: 'POST',
      body: {
        customerPhone: form.customerPhone,
        customerName: form.customerName || undefined,
        serviceId: form.serviceId,
        professionalId: slot.value.professionalId,
        startsAt: slot.value.startsAt,
        notes: form.notes || undefined,
      },
    });
    creating.value = false;
    const day = isoDate(created.startsAt);
    if (day === date.value) await load();
    else date.value = day;
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    busy.value = false;
  }
}
function open(a: any) {
  selected.value = a;
  rescheduling.value = false;
  slot.value = null;
  formError.value = '';
}
async function setStatus(status: string) {
  if (status === 'CANCELLED' && !confirm('¿Cancelar esta cita? Se avisará al cliente por WhatsApp.')) return;
  busy.value = true;
  formError.value = '';
  try {
    await api(`/appointments/${selected.value.id}/status`, { method: 'PATCH', body: { status } });
    selected.value = null;
    await load();
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    busy.value = false;
  }
}
async function reschedule() {
  if (!slot.value) return;
  busy.value = true;
  formError.value = '';
  try {
    const moved = await api(`/appointments/${selected.value.id}/reschedule`, { method: 'POST', body: slot.value });
    selected.value = null;
    const day = isoDate(moved.startsAt);
    if (day === date.value) await load();
    else date.value = day;
  } catch (e: any) {
    formError.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div class="row" style="margin-bottom: 0.75rem">
      <button class="btn sm" aria-label="Día anterior" @click="date = addDays(date, -1)">‹</button>
      <div class="grow" style="text-align: center">
        <strong class="cap">{{ labelOf(date) }}</strong>
        <div v-if="date === isoDate()" class="muted small">Hoy</div>
      </div>
      <button class="btn sm" aria-label="Día siguiente" @click="date = addDays(date, 1)">›</button>
    </div>
    <div class="row" style="margin-bottom: 0.75rem">
      <input v-model="date" type="date" aria-label="Ir a una fecha" class="grow" />
      <button v-if="date !== isoDate()" class="btn sm" @click="date = isoDate()">Hoy</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="empty">Cargando…</p>
    <template v-else>
      <p v-if="!visible.length" class="empty">No hay citas para este día.</p>
      <button v-for="a in visible" :key="a.id" class="card" :data-appt="a.id" @click="open(a)">
        <div class="row">
          <span class="time" :class="{ struck: a.status === 'CANCELLED' }">{{ time(a.startsAt) }}</span>
          <div class="grow">
            <div class="ellipsis"><strong>{{ a.customer.name || a.customer.phone }}</strong></div>
            <div class="muted small">
              <span class="dot" :style="{ background: a.professional.color || undefined }" />
              {{ a.service.name }} · {{ a.professional.name }}
            </div>
          </div>
          <span class="chip" :class="a.status">{{ STATUS_LABEL[a.status] }}</span>
        </div>
      </button>
      <button v-if="cancelledCount" class="btn ghost block sm" style="margin-top: 0.5rem" @click="showCancelled = !showCancelled">
        {{ showCancelled ? 'Ocultar' : 'Ver' }} canceladas ({{ cancelledCount }})
      </button>
    </template>

    <button class="fab" aria-label="Nueva cita" @click="openCreate">+</button>

    <!-- Nueva cita -->
    <AppSheet v-if="creating" title="Nueva cita" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <div class="cols">
          <div class="field">
            <label for="c-phone">Teléfono del cliente</label>
            <input id="c-phone" v-model="form.customerPhone" type="tel" placeholder="0991234567" required />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="c-name">Nombre</label>
            <input id="c-name" v-model="form.customerName" />
          </div>
        </div>
        <div class="field">
          <label for="c-service">Servicio</label>
          <select id="c-service" v-model="form.serviceId" required @change="form.professionalId = null">
            <option :value="null" disabled>Elegir…</option>
            <option v-for="s in activeServices" :key="s.id" :value="s.id">{{ s.name }} ({{ s.durationMinutes }} min)</option>
          </select>
        </div>
        <div class="field">
          <label for="c-pro">Profesional</label>
          <select id="c-pro" v-model="form.professionalId">
            <option :value="null">Cualquiera disponible</option>
            <option v-for="p in eligiblePros" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <SlotPicker v-model="slot" :service-id="form.serviceId" :professional-id="form.professionalId" :initial-date="date" />
        <div class="field">
          <label for="c-notes">Notas</label>
          <input id="c-notes" v-model="form.notes" />
        </div>
        <p v-if="formError" class="error" role="alert">{{ formError }}</p>
        <button class="btn primary block" :disabled="busy || !slot">Guardar cita</button>
      </form>
    </AppSheet>

    <!-- Detalle de la cita -->
    <AppSheet v-if="selected" :title="selected.customer.name || selected.customer.phone" @close="selected = null">
      <div class="stack">
        <div>
          <span class="chip" :class="selected.status">{{ STATUS_LABEL[selected.status] }}</span>
          <span v-if="selected.source === 'MANUAL'" class="chip" style="margin-left: 0.3rem">Registrada por el local</span>
        </div>
        <p>
          <strong>{{ selected.service.name }}</strong> con {{ selected.professional.name }}<br />
          <span class="cap">{{ labelOf(isoDate(selected.startsAt)) }}</span>, {{ time(selected.startsAt) }}<br />
          <a :href="`https://wa.me/${selected.customer.phone}`" target="_blank" rel="noopener">+{{ selected.customer.phone }}</a>
          <span v-if="selected.customer.noShowCount" class="chip danger" style="margin-left: 0.4rem">
            {{ selected.customer.noShowCount }} falta(s)
          </span>
        </p>
        <p v-if="selected.notes" class="muted">{{ selected.notes }}</p>
        <p v-if="formError" class="error" role="alert">{{ formError }}</p>

        <template v-if="isActive(selected) && !rescheduling">
          <button v-if="selected.status === 'PENDING'" class="btn block" :disabled="busy" @click="setStatus('CONFIRMED')">✅ Marcar confirmada</button>
          <button class="btn primary block" :disabled="busy" @click="setStatus('COMPLETED')">Atendida</button>
          <div class="cols">
            <button class="btn" :disabled="busy" @click="rescheduling = true">Reprogramar</button>
            <button class="btn" :disabled="busy" @click="setStatus('NO_SHOW')">No asistió</button>
          </div>
          <button class="btn danger block" :disabled="busy" @click="setStatus('CANCELLED')">Cancelar cita</button>
        </template>
        <template v-else-if="rescheduling">
          <h3>Nuevo horario</h3>
          <SlotPicker
            v-model="slot"
            :service-id="selected.serviceId"
            :professional-id="null"
            :ignore-appointment-id="selected.id"
            :initial-date="isoDate(selected.startsAt)"
          />
          <div class="cols">
            <button class="btn" @click="rescheduling = false">Volver</button>
            <button class="btn primary" :disabled="busy || !slot" @click="reschedule">Mover cita</button>
          </div>
        </template>
      </div>
    </AppSheet>
  </div>
</template>
