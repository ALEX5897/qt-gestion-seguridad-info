<script setup lang="ts">
// Servicios y equipo del local, con horarios semanales.
const api = useApi();
const { isOwner } = useSession();
const { minutesToHHMM, hhmmToMinutes, money } = useDates();

const tab = ref<'services' | 'team'>('services');
const services = ref<any[]>([]);
const pros = ref<any[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref('');

async function load() {
  [services.value, pros.value] = await Promise.all([api('/services'), api('/professionals')]);
  loading.value = false;
}
onMounted(load);

// ───── Servicios ─────
const svc = ref<any | null>(null);
function editService(s?: any) {
  error.value = '';
  svc.value = s
    ? { id: s.id, name: s.name, durationMinutes: s.durationMinutes, bufferMinutes: s.bufferMinutes, price: s.priceCents == null ? '' : (s.priceCents / 100).toFixed(2), active: s.active }
    : { name: '', durationMinutes: 30, bufferMinutes: 0, price: '', active: true };
}
async function saveService() {
  busy.value = true;
  error.value = '';
  try {
    const { id, price, ...rest } = svc.value;
    const body = { ...rest, priceCents: price === '' || price == null ? null : Math.round(Number(price) * 100) };
    await api(id ? `/services/${id}` : '/services', { method: id ? 'PATCH' : 'POST', body });
    svc.value = null;
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}

// ───── Equipo ─────
interface DayForm { on: boolean; start: string; end: string; split: boolean; start2: string; end2: string }
const pro = ref<any | null>(null);

function editPro(p?: any) {
  error.value = '';
  const days: DayForm[] = WEEKDAYS.map((_, i) => {
    const ranges = (p?.workingHours ?? []).filter((w: any) => w.weekday === i + 1).sort((a: any, b: any) => a.startMinute - b.startMinute);
    return {
      on: p ? ranges.length > 0 : i < 6,
      start: minutesToHHMM(ranges[0]?.startMinute ?? 540),
      end: minutesToHHMM(ranges[0]?.endMinute ?? 1080),
      split: ranges.length > 1,
      start2: minutesToHHMM(ranges[1]?.startMinute ?? 840),
      end2: minutesToHHMM(ranges[1]?.endMinute ?? 1140),
    };
  });
  pro.value = {
    id: p?.id,
    name: p?.name ?? '',
    phone: p?.phone ?? '',
    color: p?.color ?? '#7c3aed',
    active: p?.active ?? true,
    days,
    serviceIds: (p?.services ?? []).map((s: any) => s.serviceId),
  };
}
async function savePro() {
  busy.value = true;
  error.value = '';
  try {
    const p = pro.value;
    const workingHours = p.days.flatMap((d: DayForm, i: number) =>
      !d.on
        ? []
        : [
            { weekday: i + 1, startMinute: hhmmToMinutes(d.start), endMinute: hhmmToMinutes(d.end) },
            ...(d.split ? [{ weekday: i + 1, startMinute: hhmmToMinutes(d.start2), endMinute: hhmmToMinutes(d.end2) }] : []),
          ],
    );
    const body = {
      name: p.name,
      phone: p.phone || undefined,
      color: p.color,
      active: p.active,
      workingHours,
      services: p.serviceIds.map((serviceId: number) => ({ serviceId })),
    };
    await api(p.id ? `/professionals/${p.id}` : '/professionals', { method: p.id ? 'PATCH' : 'POST', body });
    pro.value = null;
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const scheduleSummary = (p: any) => {
  const days = [...new Set(p.workingHours.map((w: any) => w.weekday))] as number[];
  return days.length ? days.map((d) => WEEKDAYS[d - 1].slice(0, 2)).join(' · ') : 'Sin horario';
};
</script>

<template>
  <div>
    <div class="segmented" role="tablist">
      <button role="tab" :class="{ on: tab === 'services' }" @click="tab = 'services'">Servicios</button>
      <button role="tab" :class="{ on: tab === 'team' }" @click="tab = 'team'">Equipo</button>
    </div>
    <p v-if="loading" class="empty">Cargando…</p>

    <template v-else-if="tab === 'services'">
      <p v-if="!services.length" class="empty">Crea tu primer servicio para que tus clientes puedan reservar.</p>
      <button v-for="s in services" :key="s.id" class="card" :disabled="!isOwner" @click="editService(s)">
        <div class="row">
          <div class="grow">
            <strong>{{ s.name }}</strong>
            <div class="muted small">
              {{ s.durationMinutes }} min<span v-if="s.bufferMinutes"> + {{ s.bufferMinutes }} de limpieza</span>
              <span v-if="s.priceCents != null"> · {{ money(s.priceCents) }}</span>
            </div>
          </div>
          <span v-if="!s.active" class="chip">Inactivo</span>
        </div>
      </button>
      <button v-if="isOwner" class="fab" aria-label="Nuevo servicio" @click="editService()">+</button>
    </template>

    <template v-else>
      <p v-if="!pros.length" class="empty">Agrega a las personas que atienden en tu local.</p>
      <button v-for="p in pros" :key="p.id" class="card" :disabled="!isOwner" @click="editPro(p)">
        <div class="row">
          <span class="dot" :style="{ background: p.color || undefined }" />
          <div class="grow">
            <strong>{{ p.name }}</strong>
            <div class="muted small">{{ scheduleSummary(p) }} · {{ p.services.length }} servicio(s)</div>
          </div>
          <span v-if="!p.active" class="chip">Inactivo</span>
        </div>
      </button>
      <button v-if="isOwner" class="fab" aria-label="Nuevo profesional" @click="editPro()">+</button>
    </template>

    <AppSheet v-if="svc" :title="svc.id ? 'Editar servicio' : 'Nuevo servicio'" @close="svc = null">
      <form class="stack" @submit.prevent="saveService">
        <div class="field">
          <label for="s-name">Nombre</label>
          <input id="s-name" v-model="svc.name" required minlength="2" maxlength="60" />
        </div>
        <div class="cols">
          <div class="field">
            <label for="s-dur">Duración (min)</label>
            <input id="s-dur" v-model.number="svc.durationMinutes" type="number" min="5" max="600" step="5" required />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="s-buf">Limpieza después (min)</label>
            <input id="s-buf" v-model.number="svc.bufferMinutes" type="number" min="0" max="120" step="5" />
          </div>
        </div>
        <div class="field">
          <label for="s-price">Precio (USD, opcional)</label>
          <input id="s-price" v-model="svc.price" type="number" min="0" step="0.01" inputmode="decimal" />
        </div>
        <label class="check"><input v-model="svc.active" type="checkbox" /> Disponible para reservar</label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="btn primary block" :disabled="busy">Guardar</button>
      </form>
    </AppSheet>

    <AppSheet v-if="pro" :title="pro.id ? 'Editar profesional' : 'Nuevo profesional'" @close="pro = null">
      <form class="stack" @submit.prevent="savePro">
        <div class="row">
          <div class="field grow">
            <label for="p-name">Nombre</label>
            <input id="p-name" v-model="pro.name" required minlength="2" maxlength="60" />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="p-color">Color</label>
            <input id="p-color" v-model="pro.color" type="color" />
          </div>
        </div>
        <label class="check"><input v-model="pro.active" type="checkbox" /> Activo (recibe reservas)</label>

        <h3>Servicios que realiza</h3>
        <p v-if="!services.length" class="muted small">Primero crea servicios.</p>
        <label v-for="s in services" :key="s.id" class="check" style="margin-top: 0.4rem">
          <input v-model="pro.serviceIds" type="checkbox" :value="s.id" /> {{ s.name }}
        </label>

        <h3>Horario semanal</h3>
        <div v-for="(d, i) in pro.days" :key="i" style="border-top: 1px solid var(--line); padding: 0.5rem 0">
          <label class="check"><input v-model="d.on" type="checkbox" /> {{ WEEKDAYS[i] }}</label>
          <template v-if="d.on">
            <div class="row" style="margin-top: 0.4rem">
              <input v-model="d.start" type="time" :aria-label="`${WEEKDAYS[i]} desde`" required />
              <span>a</span>
              <input v-model="d.end" type="time" :aria-label="`${WEEKDAYS[i]} hasta`" required />
            </div>
            <label class="check small" style="margin-top: 0.4rem"><input v-model="d.split" type="checkbox" /> Tiene descanso (segundo turno)</label>
            <div v-if="d.split" class="row" style="margin-top: 0.4rem">
              <input v-model="d.start2" type="time" :aria-label="`${WEEKDAYS[i]} segundo turno desde`" required />
              <span>a</span>
              <input v-model="d.end2" type="time" :aria-label="`${WEEKDAYS[i]} segundo turno hasta`" required />
            </div>
          </template>
        </div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="btn primary block" :disabled="busy">Guardar</button>
      </form>
    </AppSheet>
  </div>
</template>
