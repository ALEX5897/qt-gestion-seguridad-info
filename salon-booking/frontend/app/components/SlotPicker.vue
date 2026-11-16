<script setup lang="ts">
// Elige día y hora libre para un servicio; muestra los horarios reales de la agenda.
const props = defineProps<{
  serviceId: number | null;
  professionalId: number | null;
  ignoreAppointmentId?: number;
  /** Día en el que arranca el selector (YYYY-MM-DD); si ya pasó, se usa hoy. */
  initialDate?: string;
}>();
const model = defineModel<{ professionalId: number; startsAt: string } | null>({ default: null });

const api = useApi();
const { isoDate, time } = useDates();
const date = ref(props.initialDate && props.initialDate > isoDate() ? props.initialDate : isoDate());
const options = ref<{ professionalId: number; professionalName: string; start: string }[]>([]);
const loading = ref(false);
const error = ref('');

async function load() {
  model.value = null;
  options.value = [];
  if (!props.serviceId || !date.value) return;
  loading.value = true;
  error.value = '';
  try {
    const q = new URLSearchParams({ serviceId: String(props.serviceId), date: date.value });
    if (props.professionalId) q.set('professionalId', String(props.professionalId));
    if (props.ignoreAppointmentId) q.set('ignoreAppointmentId', String(props.ignoreAppointmentId));
    const res = await api<any[]>(`/availability?${q}`);
    const seen = new Set<string>();
    options.value = res
      .flatMap((p) => p.slots.map((s: any) => ({ professionalId: p.professionalId, professionalName: p.professionalName, start: s.start })))
      .sort((a, b) => a.start.localeCompare(b.start))
      .filter((o) => (seen.has(o.start) ? false : (seen.add(o.start), true)));
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}
watch(() => [props.serviceId, props.professionalId, date.value], load, { immediate: true });
</script>

<template>
  <div>
    <div class="field">
      <label for="slot-date">Día</label>
      <input id="slot-date" v-model="date" type="date" :min="isoDate()" />
    </div>
    <div class="field">
      <label>Hora</label>
      <p v-if="!serviceId" class="muted small">Elige primero el servicio.</p>
      <p v-else-if="loading" class="muted small">Buscando horarios…</p>
      <p v-else-if="error" class="error">{{ error }}</p>
      <p v-else-if="!options.length" class="muted small">No hay horarios libres ese día.</p>
      <div v-else class="slots">
        <button
          v-for="o in options"
          :key="o.start"
          type="button"
          :class="{ on: model?.startsAt === o.start }"
          :title="o.professionalName"
          @click="model = { professionalId: o.professionalId, startsAt: o.start }"
        >
          {{ time(o.start) }}
        </button>
      </div>
      <p v-if="model && !professionalId" class="muted small" style="margin-top: 0.4rem">
        Con {{ options.find((o) => o.start === model!.startsAt)?.professionalName }}
      </p>
    </div>
  </div>
</template>
