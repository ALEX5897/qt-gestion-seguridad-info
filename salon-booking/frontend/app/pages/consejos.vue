<script setup lang="ts">
// Indicadores de los últimos 30 días y consejos generados con IA para decidir mejor.
const api = useApi();
const { isOwner } = useSession();
const { money, dateTime } = useDates();

const data = ref<any | null>(null);
const loading = ref(true);
const generating = ref(false);
const error = ref('');

onMounted(async () => {
  if (!isOwner.value) return navigateTo('/');
  try {
    data.value = await api('/insights');
  } catch (e: any) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
});

async function generate() {
  generating.value = true;
  error.value = '';
  try {
    data.value.advice = await api('/insights/advice', { method: 'POST' });
  } catch (e: any) {
    error.value = e.message;
  } finally {
    generating.value = false;
  }
}
const m = computed(() => data.value?.metrics);
const IMPACT: Record<string, [string, string]> = { alto: ['Impacto alto', 'ok'], medio: ['Impacto medio', 'warn'], bajo: ['Impacto bajo', ''] };
</script>

<template>
  <div>
    <div class="row" style="margin-bottom: 0.75rem">
      <NuxtLink to="/mas" class="btn sm">‹ Volver</NuxtLink>
      <h2 style="margin: 0">Consejos del negocio</h2>
    </div>
    <p v-if="loading" class="empty">Cargando…</p>
    <p v-if="error" class="error" role="alert" style="margin-bottom: 0.75rem">{{ error }}</p>

    <template v-if="m">
      <p class="muted small">Últimos {{ m.periodo.dias }} días</p>
      <div class="tiles">
        <div class="tile"><b>{{ m.citas.total }}</b><span class="muted small">citas</span></div>
        <div class="tile"><b>{{ m.ocupacionPct }}%</b><span class="muted small">ocupación</span></div>
        <div class="tile"><b>{{ m.citas.tasaInasistenciaPct }}%</b><span class="muted small">inasistencias</span></div>
        <div class="tile"><b>{{ money(m.ingresosEstimadosCents) }}</b><span class="muted small">ingresos estimados</span></div>
        <div class="tile"><b>{{ m.clientes.nuevos }}</b><span class="muted small">clientes nuevos</span></div>
        <div class="tile"><b>{{ m.clientes.inactivos }}</b><span class="muted small">sin venir hace {{ m.clientes.diasParaInactivo }}+ días</span></div>
        <div class="tile"><b>{{ m.citas.porWhatsapp }}</b><span class="muted small">reservas por WhatsApp</span></div>
        <div class="tile"><b>{{ m.filaDeEspera.solicitudes }}</b><span class="muted small">en fila de espera</span></div>
      </div>

      <h3>Consejos con IA</h3>
      <div v-if="data.advice" class="stack">
        <div class="card">
          <p style="margin: 0">{{ data.advice.resumen }}</p>
          <p class="muted small" style="margin: 0.4rem 0 0">Generado el {{ dateTime(data.advice.generadoEl) }}</p>
        </div>
        <div v-for="(c, i) in data.advice.consejos" :key="i" class="card" data-consejo>
          <div class="row">
            <strong class="grow">{{ i + 1 }}. {{ c.titulo }}</strong>
            <span class="chip" :class="IMPACT[c.impacto]?.[1]">{{ IMPACT[c.impacto]?.[0] }}</span>
          </div>
          <p class="small muted" style="margin: 0.3rem 0">{{ c.por_que }}</p>
          <p style="margin: 0">👉 {{ c.accion }}</p>
        </div>
      </div>
      <p v-else-if="!data.aiAvailable" class="muted small">La IA no está activada en esta plataforma. Los indicadores de arriba siguen disponibles.</p>
      <p v-else class="muted small">Un análisis de tus indicadores con acciones concretas para llenar tu agenda y recuperar clientes.</p>
      <button v-if="data.aiAvailable" class="btn primary block" style="margin-top: 0.75rem" :disabled="generating" @click="generate">
        {{ generating ? 'Analizando…' : data.advice ? 'Actualizar análisis' : 'Generar análisis' }}
      </button>
      <p v-if="data.advice" class="muted small" style="margin-top: 0.4rem">El análisis se renueva como máximo cada 6 horas.</p>

      <h3>Ocupación por día</h3>
      <div class="card">
        <div v-for="d in m.ocupacionPorDia" :key="d.dia" class="row small" style="padding: 0.25rem 0">
          <span class="cap" style="width: 5.5rem">{{ d.dia }}</span>
          <div class="bar grow"><i :style="{ width: Math.min(d.ocupacionPct, 100) + '%' }" /></div>
          <span style="width: 5rem; text-align: right">{{ d.ocupacionPct }}% · {{ d.citas }}</span>
        </div>
      </div>

      <h3>Servicios</h3>
      <div class="card">
        <p v-if="!m.servicios.length" class="muted small" style="margin: 0">Sin citas en el período.</p>
        <div v-for="s in m.servicios" :key="s.nombre" class="row small" style="padding: 0.25rem 0">
          <span class="grow">{{ s.nombre }}</span>
          <span>{{ s.citas }} cita(s) · {{ money(s.ingresosCents) }}</span>
        </div>
      </div>

      <h3>Equipo</h3>
      <div class="card">
        <div v-for="p in m.profesionales" :key="p.nombre" class="row small" style="padding: 0.25rem 0">
          <span style="width: 5.5rem" class="ellipsis">{{ p.nombre }}</span>
          <div class="bar grow"><i :style="{ width: Math.min(p.ocupacionPct, 100) + '%' }" /></div>
          <span style="width: 5rem; text-align: right">{{ p.ocupacionPct }}% · {{ p.citas }}</span>
        </div>
      </div>
    </template>
  </div>
</template>
