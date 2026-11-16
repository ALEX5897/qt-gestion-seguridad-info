<script setup lang="ts">
// Administrador general: locales suscritos, alta, suspensión y pagos.
definePageMeta({ layout: 'admin' });
const api = useApi();

const tenants = ref<any[]>([]);
const plans = ref<any[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const creating = ref(false);
const paying = ref<any | null>(null);

const blank = () => ({ name: '', slug: '', whatsappNumber: '', waPhoneNumberId: '', address: '', trialDays: 14, ownerName: '', ownerEmail: '', ownerPassword: '' });
const form = reactive(blank());
const pay = reactive({ planCode: '', months: 1, amount: '', method: 'TRANSFER', reference: '' });

async function load() {
  [tenants.value, plans.value] = await Promise.all([api('/admin/tenants'), api('/admin/plans')]);
  loading.value = false;
}
onMounted(load);

const day = (d: string | null) => (d ? new Date(d).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const STATE: Record<string, [string, string]> = {
  OK: ['Activo', 'ok'],
  SUSPENDED: ['Suspendido', 'danger'],
  TRIAL_EXPIRED: ['Prueba vencida', 'danger'],
  EXPIRED: ['Suscripción vencida', 'danger'],
  NO_SUBSCRIPTION: ['Sin suscripción', 'danger'],
};
const stateOf = (t: any) => (t.reason === 'OK' && t.status === 'TRIAL' ? ['En prueba', 'warn'] : STATE[t.reason]);
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');

async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  try {
    await fn();
    await load();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function openCreate() {
  Object.assign(form, blank());
  error.value = '';
  creating.value = true;
}
const create = () =>
  run(async () => {
    await api('/admin/tenants', {
      method: 'POST',
      body: { ...form, whatsappNumber: form.whatsappNumber.replace(/\D/g, ''), waPhoneNumberId: form.waPhoneNumberId || undefined, address: form.address || undefined },
    });
    creating.value = false;
  });
const setStatus = (t: any, status: string) => {
  if (status === 'SUSPENDED' && !confirm(`¿Suspender "${t.name}"? El bot dejará de atender a sus clientes.`)) return;
  return run(() => api(`/admin/tenants/${t.id}/status`, { method: 'PATCH', body: { status } }));
};
function openPay(t: any) {
  const plan = t.plan ?? plans.value[0];
  Object.assign(pay, { planCode: plan?.code ?? '', months: 1, amount: plan ? (plan.priceCents / 100).toFixed(2) : '', method: 'TRANSFER', reference: '' });
  error.value = '';
  paying.value = t;
}
watch(() => [pay.planCode, pay.months], () => {
  const plan = plans.value.find((p) => p.code === pay.planCode);
  if (plan) pay.amount = ((plan.priceCents * pay.months) / 100).toFixed(2);
});
const registerPayment = () =>
  run(async () => {
    await api(`/admin/tenants/${paying.value.id}/payments`, {
      method: 'POST',
      body: { planCode: pay.planCode, months: pay.months, amountCents: Math.round(Number(pay.amount) * 100), method: pay.method, reference: pay.reference || undefined },
    });
    paying.value = null;
  });
</script>

<template>
  <div>
    <div class="row" style="margin-bottom: 0.9rem">
      <h2 class="grow" style="margin: 0">Locales ({{ tenants.length }})</h2>
      <button class="btn primary" @click="openCreate">+ Nuevo local</button>
    </div>
    <p v-if="error && !creating && !paying" class="error" role="alert">{{ error }}</p>
    <p v-if="loading" class="empty">Cargando…</p>
    <p v-else-if="!tenants.length" class="empty">Aún no hay locales registrados.</p>

    <div v-for="t in tenants" :key="t.id" class="card" :data-tenant="t.slug">
      <div class="row wrap">
        <div class="grow">
          <strong>{{ t.name }}</strong>
          <span class="chip" :class="stateOf(t)[1]" style="margin-left: 0.4rem">{{ stateOf(t)[0] }}</span>
          <div class="muted small">WhatsApp +{{ t.whatsappNumber }} · {{ t.owner?.name }} ({{ t.owner?.email }})</div>
          <div class="muted small">
            {{ t.plan ? `Plan ${t.plan.name}` : 'Sin plan (prueba)' }} · vence {{ day(t.validUntil) }} ·
            {{ t.usage.professionals }} profesional(es) · {{ t.usage.customers }} cliente(s) ·
            {{ t.usage.messagesThisMonth }}<span v-if="t.plan"> / {{ t.plan.monthlyMessageQuota }}</span> mensajes este mes
          </div>
        </div>
        <div class="row">
          <button class="btn sm" :disabled="busy" @click="openPay(t)">Registrar pago</button>
          <button v-if="t.status !== 'SUSPENDED'" class="btn sm danger" :disabled="busy" @click="setStatus(t, 'SUSPENDED')">Suspender</button>
          <button v-else class="btn sm" :disabled="busy" @click="setStatus(t, t.plan ? 'ACTIVE' : 'TRIAL')">Reactivar</button>
        </div>
      </div>
    </div>

    <AppSheet v-if="creating" title="Nuevo local" @close="creating = false">
      <form class="stack" @submit.prevent="create">
        <div class="field">
          <label for="n-name">Nombre del local</label>
          <input id="n-name" v-model="form.name" required @input="form.slug = slugify(form.name)" />
        </div>
        <div class="cols">
          <div class="field">
            <label for="n-slug">Identificador</label>
            <input id="n-slug" v-model="form.slug" required pattern="[a-z0-9\-]+" />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="n-trial">Días de prueba</label>
            <input id="n-trial" v-model.number="form.trialDays" type="number" min="0" max="90" />
          </div>
        </div>
        <div class="field">
          <label for="n-wa">Número de WhatsApp del local (con código de país)</label>
          <input id="n-wa" v-model="form.whatsappNumber" type="tel" placeholder="593991234567" required />
        </div>
        <div class="field">
          <label for="n-pnid">Phone number ID de Meta (opcional)</label>
          <input id="n-pnid" v-model="form.waPhoneNumberId" />
        </div>
        <div class="field">
          <label for="n-address">Dirección (opcional)</label>
          <input id="n-address" v-model="form.address" />
        </div>
        <h3>Cuenta del dueño</h3>
        <div class="field"><label for="n-oname">Nombre</label><input id="n-oname" v-model="form.ownerName" required /></div>
        <div class="field"><label for="n-oemail">Correo</label><input id="n-oemail" v-model="form.ownerEmail" type="email" required /></div>
        <div class="field"><label for="n-opass">Contraseña inicial (mínimo 8)</label><input id="n-opass" v-model="form.ownerPassword" type="text" minlength="8" required autocomplete="off" /></div>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="btn primary block" :disabled="busy">Crear local</button>
      </form>
    </AppSheet>

    <AppSheet v-if="paying" :title="`Registrar pago · ${paying.name}`" @close="paying = null">
      <form class="stack" @submit.prevent="registerPayment">
        <div class="cols">
          <div class="field">
            <label for="y-plan">Plan</label>
            <select id="y-plan" v-model="pay.planCode" required>
              <option v-for="p in plans" :key="p.code" :value="p.code">{{ p.name }} (${{ (p.priceCents / 100).toFixed(2) }}/mes)</option>
            </select>
          </div>
          <div class="field" style="margin-top: 0">
            <label for="y-months">Meses</label>
            <input id="y-months" v-model.number="pay.months" type="number" min="1" max="24" required />
          </div>
        </div>
        <div class="cols">
          <div class="field">
            <label for="y-amount">Monto recibido (USD)</label>
            <input id="y-amount" v-model="pay.amount" type="number" min="0" step="0.01" required />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="y-method">Forma de pago</label>
            <select id="y-method" v-model="pay.method">
              <option value="TRANSFER">Transferencia</option>
              <option value="DEPOSIT">Depósito</option>
              <option value="CASH">Efectivo</option>
              <option value="CARD">Tarjeta</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="y-ref">Referencia / comprobante</label>
          <input id="y-ref" v-model="pay.reference" />
        </div>
        <p class="muted small">El pago extiende la suscripción desde su vencimiento actual y reactiva el local.</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <button class="btn primary block" :disabled="busy">Guardar pago</button>
      </form>
    </AppSheet>
  </div>
</template>
