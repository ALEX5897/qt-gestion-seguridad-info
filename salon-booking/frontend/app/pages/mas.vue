<script setup lang="ts">
// Fila de espera, bloqueos de agenda, ajustes del local, personal y suscripción.
const api = useApi();
const { me, isOwner, loadMe, logout } = useSession();
const { dateTime, labelOf, isoDate, zonedToIso } = useDates();

type Section = 'menu' | 'waitlist' | 'timeoff' | 'settings' | 'staff' | 'whatsapp';
const section = ref<Section>('menu');
const busy = ref(false);
const error = ref('');
const saved = ref(false);

// ───── Fila de espera ─────
const waitlist = ref<any[]>([]);
// ───── Bloqueos ─────
const timeOffs = ref<any[]>([]);
const pros = ref<any[]>([]);
const off = reactive({ professionalId: null as number | null, from: '', to: '', reason: '' });
// ───── Ajustes ─────
const settings = reactive<Record<string, any>>({});
// ───── Personal ─────
const staff = ref<any[]>([]);
const newStaff = reactive({ name: '', email: '', password: '' });
// ───── Vinculación de WhatsApp (modo de pruebas con código QR) ─────
const link = ref<{ state: string; qr: string | null; pairingCode: string | null; linkedNumber: string | null; error: string | null } | null>(null);
const linkPhone = ref('');
let linkTimer: ReturnType<typeof setInterval> | undefined;
async function refreshLink() {
  try {
    link.value = await api('/whatsapp/link');
  } catch {
    /* se reintenta en el siguiente ciclo */
  }
}
function watchLink() {
  clearInterval(linkTimer);
  linkTimer = setInterval(() => {
    if (section.value !== 'whatsapp') return clearInterval(linkTimer);
    refreshLink();
  }, 3000);
}
onUnmounted(() => clearInterval(linkTimer));

async function open(s: Section) {
  section.value = s;
  error.value = '';
  saved.value = false;
  if (s === 'waitlist') waitlist.value = await api('/waitlist');
  if (s === 'timeoff') {
    // Los valores iniciales van antes de cargar datos para no pisar lo que el usuario escriba.
    const today = isoDate();
    Object.assign(off, { professionalId: null, from: `${today}T09:00`, to: `${today}T19:00`, reason: '' });
    [timeOffs.value, pros.value] = await Promise.all([api('/time-offs'), api('/professionals')]);
  }
  if (s === 'settings') {
    const t = me.value!.tenant!;
    for (const k of ['name', 'address', 'slotStepMinutes', 'minAdvanceMinutes', 'maxAdvanceDays', 'reminderHoursBefore', 'confirmationTimeoutMinutes', 'waitlistOfferMinutes', 'assistantInfo', 'winbackDays']) {
      settings[k] = t[k] ?? '';
    }
    settings.aiEnabled = t.aiEnabled;
  }
  if (s === 'staff') staff.value = await api('/staff');
  if (s === 'whatsapp') {
    await refreshLink();
    watchLink();
  }
}

async function run(fn: () => Promise<void>) {
  busy.value = true;
  error.value = '';
  saved.value = false;
  try {
    await fn();
  } catch (e: any) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
const removeWait = (id: number) =>
  run(async () => {
    await api(`/waitlist/${id}/remove`, { method: 'POST' });
    waitlist.value = await api('/waitlist');
  });
const addOff = () =>
  run(async () => {
    await api('/time-offs', {
      method: 'POST',
      body: { professionalId: off.professionalId, startsAt: zonedToIso(off.from), endsAt: zonedToIso(off.to), reason: off.reason || undefined },
    });
    timeOffs.value = await api('/time-offs');
    off.reason = '';
  });
const removeOff = (id: number) =>
  run(async () => {
    await api(`/time-offs/${id}`, { method: 'DELETE' });
    timeOffs.value = await api('/time-offs');
  });
const saveSettings = () =>
  run(async () => {
    await api('/tenant/settings', { method: 'PATCH', body: { ...settings, address: settings.address || undefined, assistantInfo: settings.assistantInfo ?? '' } });
    await loadMe();
    saved.value = true;
  });
const addStaff = () =>
  run(async () => {
    await api('/staff', { method: 'POST', body: { ...newStaff } });
    Object.assign(newStaff, { name: '', email: '', password: '' });
    staff.value = await api('/staff');
  });
const toggleStaff = (u: any) =>
  run(async () => {
    await api(`/staff/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
    staff.value = await api('/staff');
  });

const startLink = (withPhone: boolean) =>
  run(async () => {
    link.value = await api('/whatsapp/link', { method: 'POST', body: withPhone ? { phone: linkPhone.value } : {} });
  });
const unlink = () =>
  run(async () => {
    if (!confirm('¿Desvincular el WhatsApp del local? El bot dejará de responder hasta que vuelvas a escanear el código.')) return;
    link.value = await api('/whatsapp/link', { method: 'DELETE' });
  });
const sub = computed(() => me.value?.subscription);
const TITLES: Record<Section, string> = { menu: '', waitlist: 'Fila de espera', timeoff: 'Bloqueos de agenda', settings: 'Ajustes del local', staff: 'Personal', whatsapp: 'Conectar WhatsApp' };
</script>

<template>
  <div>
    <template v-if="section === 'menu'">
      <div class="card">
        <div class="row">
          <div class="grow">
            <strong>Suscripción</strong>
            <div class="muted small">
              {{ sub?.plan ? `Plan ${sub.plan}` : 'Período de prueba' }}
              <span v-if="sub?.validUntil"> · vence el {{ labelOf(isoDate(sub.validUntil)) }}</span>
            </div>
          </div>
          <span class="chip" :class="sub?.serviceable ? 'ok' : 'danger'">{{ sub?.serviceable ? 'Activa' : 'Inactiva' }}</span>
        </div>
        <p class="muted small" style="margin: 0.4rem 0 0">WhatsApp del local: +{{ me?.tenant?.whatsappNumber }}</p>
      </div>
      <h3>Agenda</h3>
      <button class="card" @click="open('waitlist')"><strong>⏳ Fila de espera</strong><div class="muted small">Clientes que esperan un cupo</div></button>
      <button class="card" @click="open('timeoff')"><strong>🚫 Bloqueos</strong><div class="muted small">Feriados, vacaciones y ausencias</div></button>
      <template v-if="isOwner">
        <h3>Crecer</h3>
        <NuxtLink to="/consejos" class="card" style="display: block; color: inherit">
          <strong>💡 Consejos del negocio</strong>
          <div class="muted small">Indicadores del mes y recomendaciones con IA</div>
        </NuxtLink>
        <h3>Configuración</h3>
        <button class="card" @click="open('settings')"><strong>⚙️ Ajustes del local</strong><div class="muted small">Reservas, recordatorios, asistente con IA e invitaciones</div></button>
        <button v-if="me?.whatsappProvider === 'baileys'" class="card" @click="open('whatsapp')">
          <strong>📱 Conectar WhatsApp</strong>
          <div class="muted small">Vincula el teléfono del local con un código QR (modo de pruebas)</div>
        </button>
        <button class="card" @click="open('staff')"><strong>🧑‍💼 Personal</strong><div class="muted small">Cuentas para tu equipo</div></button>
      </template>
      <h3>Cuenta</h3>
      <div class="card">
        <strong>{{ me?.user.name }}</strong>
        <div class="muted small">{{ me?.user.email }}</div>
      </div>
      <button class="btn block" style="margin-top: 0.75rem" @click="logout">Cerrar sesión</button>
    </template>

    <template v-else>
      <div class="row" style="margin-bottom: 0.75rem">
        <button class="btn sm" @click="section = 'menu'">‹ Volver</button>
        <h2 style="margin: 0">{{ TITLES[section] }}</h2>
      </div>
      <p v-if="error" class="error" role="alert" style="margin-bottom: 0.75rem">{{ error }}</p>

      <template v-if="section === 'waitlist'">
        <p v-if="!waitlist.length" class="empty">Nadie está en fila de espera.</p>
        <div v-for="w in waitlist" :key="w.id" class="card">
          <div class="row">
            <div class="grow">
              <strong>{{ w.customer.name || '+' + w.customer.phone }}</strong>
              <div class="muted small">{{ w.service.name }} · <span class="cap">{{ labelOf(w.date.slice(0, 10)) }}</span></div>
            </div>
            <span v-if="w.status === 'OFFERED'" class="chip warn">Cupo ofrecido</span>
            <button class="btn sm danger" :disabled="busy" @click="removeWait(w.id)">Quitar</button>
          </div>
        </div>
      </template>

      <template v-if="section === 'timeoff'">
        <form class="card stack" @submit.prevent="addOff">
          <div class="field">
            <label for="o-pro">¿Quién?</label>
            <select id="o-pro" v-model="off.professionalId">
              <option :value="null">Todo el local</option>
              <option v-for="p in pros.filter((x) => x.active)" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </div>
          <div class="cols">
            <div class="field">
              <label for="o-from">Desde</label>
              <input id="o-from" v-model="off.from" type="datetime-local" required />
            </div>
            <div class="field" style="margin-top: 0">
              <label for="o-to">Hasta</label>
              <input id="o-to" v-model="off.to" type="datetime-local" required />
            </div>
          </div>
          <div class="field">
            <label for="o-reason">Motivo (opcional)</label>
            <input id="o-reason" v-model="off.reason" maxlength="120" />
          </div>
          <button class="btn primary block" :disabled="busy">Agregar bloqueo</button>
          <p class="muted small">Las citas ya agendadas en ese rango no se cancelan solas: revísalas en la agenda.</p>
        </form>
        <h3>Próximos bloqueos</h3>
        <p v-if="!timeOffs.length" class="muted small">No hay bloqueos.</p>
        <div v-for="t in timeOffs" :key="t.id" class="card">
          <div class="row">
            <div class="grow">
              <strong>{{ t.professional?.name ?? 'Todo el local' }}</strong><span v-if="t.reason"> · {{ t.reason }}</span>
              <div class="muted small">{{ dateTime(t.startsAt) }} → {{ dateTime(t.endsAt) }}</div>
            </div>
            <button class="btn sm danger" :disabled="busy" @click="removeOff(t.id)">Quitar</button>
          </div>
        </div>
      </template>

      <form v-if="section === 'settings'" class="card stack" @submit.prevent="saveSettings" @input="saved = false">
        <div class="field">
          <label for="t-name">Nombre del local</label>
          <input id="t-name" v-model="settings.name" required minlength="2" maxlength="80" />
        </div>
        <div class="field">
          <label for="t-address">Dirección (se envía al confirmar la cita)</label>
          <input id="t-address" v-model="settings.address" maxlength="200" />
        </div>
        <h3>Reservas</h3>
        <div class="field">
          <label for="t-step">Ofrecer horarios cada</label>
          <select id="t-step" v-model.number="settings.slotStepMinutes">
            <option v-for="m in [5, 10, 15, 20, 30, 60]" :key="m" :value="m">{{ m }} minutos</option>
          </select>
        </div>
        <div class="cols">
          <div class="field">
            <label for="t-min">Anticipación mínima (min)</label>
            <input id="t-min" v-model.number="settings.minAdvanceMinutes" type="number" min="0" max="2880" required />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="t-max">Reservar hasta (días)</label>
            <input id="t-max" v-model.number="settings.maxAdvanceDays" type="number" min="1" max="90" required />
          </div>
        </div>
        <h3>Confirmación de asistencia</h3>
        <div class="cols">
          <div class="field">
            <label for="t-rem">Preguntar (horas antes)</label>
            <input id="t-rem" v-model.number="settings.reminderHoursBefore" type="number" min="1" max="72" required />
          </div>
          <div class="field" style="margin-top: 0">
            <label for="t-timeout">Esperar respuesta (min)</label>
            <input id="t-timeout" v-model.number="settings.confirmationTimeoutMinutes" type="number" min="15" max="2880" required />
          </div>
        </div>
        <p class="muted small">Si el cliente no responde en ese tiempo, la cita se cancela y el cupo se ofrece a la fila de espera.</p>
        <h3>Fila de espera</h3>
        <div class="field">
          <label for="t-wl">Tiempo para aceptar un cupo (min)</label>
          <input id="t-wl" v-model.number="settings.waitlistOfferMinutes" type="number" min="5" max="240" required />
        </div>
        <h3>Asistente con IA</h3>
        <label class="check"><input v-model="settings.aiEnabled" type="checkbox" :disabled="!me?.ai?.configured" /> Responder con IA los mensajes escritos</label>
        <p v-if="!me?.ai?.configured" class="muted small">La IA no está activada en esta plataforma. El bot atiende con botones.</p>
        <p v-else class="muted small">
          Entiende preguntas como "¿tienen algo mañana en la tarde?", recomienda servicios y propone horarios reales.
          Nunca reserva sola: el cliente siempre confirma con un botón.
          Este mes: {{ me.ai.used }} de {{ me.ai.limit }} respuestas.
        </p>
        <div class="field">
          <label for="t-info">Lo que el asistente debe saber de tu local</label>
          <textarea id="t-info" v-model="settings.assistantInfo" maxlength="3000" placeholder="Formas de pago, parqueadero, promociones vigentes, qué incluye cada servicio…" />
        </div>
        <h3>Recuperar clientes</h3>
        <div class="field">
          <label for="t-winback">Invitar a volver a quien no viene hace</label>
          <select id="t-winback" v-model.number="settings.winbackDays">
            <option :value="0">No enviar invitaciones</option>
            <option v-for="d in [21, 30, 45, 60, 90]" :key="d" :value="d">{{ d }} días</option>
          </select>
        </div>
        <p class="muted small">Se envía un solo mensaje por ciclo, de día, y el cliente puede pedir no recibir más. Fuera de las 24 h de su último mensaje, WhatsApp exige una plantilla aprobada y cobra el envío.</p>
        <p v-if="saved" class="chip ok" role="status">Cambios guardados</p>
        <button class="btn primary block" :disabled="busy">Guardar ajustes</button>
      </form>

      <div v-if="section === 'whatsapp'" class="stack">
        <div class="banner" style="margin: 0">
          Modo de pruebas con una conexión <strong>no oficial</strong>. WhatsApp puede bloquear el número que vincules:
          usa un número de prueba, no el principal del negocio.
        </div>
        <div v-if="link?.state === 'connected'" class="card">
          <span class="chip ok">Vinculado</span>
          <p style="margin: 0.5rem 0 0">El bot está respondiendo los mensajes que llegan al <strong>+{{ link.linkedNumber }}</strong>.</p>
          <p v-if="link.linkedNumber && link.linkedNumber !== me?.tenant?.whatsappNumber" class="muted small">
            Es distinto del número registrado para el local (+{{ me?.tenant?.whatsappNumber }}); para pruebas no es problema.
          </p>
          <button class="btn danger block" style="margin-top: 0.6rem" :disabled="busy" @click="unlink">Desvincular</button>
        </div>
        <div v-else-if="link?.state === 'qr' && link.pairingCode" class="card" style="text-align: center">
          <p><strong>Escribe este código en el teléfono del local</strong></p>
          <p data-pairing style="font-size: 2rem; font-weight: 700; letter-spacing: 0.15em; margin: 0.5rem 0">{{ link.pairingCode }}</p>
          <p class="muted small" style="text-align: left">
            En ese teléfono: WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo →
            <strong>Vincular con el número de teléfono</strong>, y escribe el código. Caduca en pocos minutos.
          </p>
          <button class="btn block" :disabled="busy" @click="startLink(false)">Usar código QR en su lugar</button>
        </div>
        <div v-else-if="link?.state === 'qr'" class="card" style="text-align: center">
          <p><strong>Escanea este código con el teléfono del local</strong></p>
          <img :src="link.qr!" alt="Código QR para vincular WhatsApp" width="260" height="260" style="max-width: 100%; height: auto" />
          <p class="muted small" style="text-align: left; margin-top: 0.5rem">
            En el teléfono: WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo. El código se renueva solo.
          </p>
        </div>
        <div v-else-if="link?.state === 'connecting'" class="card"><p class="muted" style="margin: 0">Conectando con WhatsApp…</p></div>
        <div v-else class="card stack">
          <p>Al vincular, el bot responde a quien escriba a ese WhatsApp. En este modo no hay botones: el cliente contesta con el número de la opción.</p>
          <p v-if="link?.error" class="error" role="alert">{{ link.error }}</p>
          <form class="stack" @submit.prevent="startLink(true)">
            <div class="field">
              <label for="l-phone">Número de WhatsApp a vincular (con código de país)</label>
              <input id="l-phone" v-model="linkPhone" type="tel" placeholder="593991234567" required />
            </div>
            <button class="btn primary block" :disabled="busy">Vincular con código</button>
          </form>
          <p class="muted small" style="margin: 0">Recomendado si estás usando este mismo teléfono.</p>
          <button class="btn block" :disabled="busy" @click="startLink(false)">Vincular con código QR</button>
          <p class="muted small" style="margin: 0">Si tienes el panel abierto en otra pantalla.</p>
        </div>
      </div>

      <template v-if="section === 'staff'">
        <div v-for="u in staff" :key="u.id" class="card">
          <div class="row">
            <div class="grow">
              <strong>{{ u.name }}</strong>
              <div class="muted small">{{ u.email }} · {{ u.role === 'OWNER' ? 'Dueño' : 'Personal' }}</div>
            </div>
            <span v-if="!u.active" class="chip">Inactivo</span>
            <button v-if="u.role === 'STAFF'" class="btn sm" :disabled="busy" @click="toggleStaff(u)">{{ u.active ? 'Desactivar' : 'Activar' }}</button>
          </div>
        </div>
        <h3>Nueva cuenta de personal</h3>
        <form class="card stack" @submit.prevent="addStaff">
          <div class="field"><label for="st-name">Nombre</label><input id="st-name" v-model="newStaff.name" required minlength="2" /></div>
          <div class="field"><label for="st-email">Correo</label><input id="st-email" v-model="newStaff.email" type="email" required /></div>
          <div class="field"><label for="st-pass">Contraseña (mínimo 8 caracteres)</label><input id="st-pass" v-model="newStaff.password" type="password" minlength="8" required autocomplete="new-password" /></div>
          <button class="btn primary block" :disabled="busy">Crear cuenta</button>
          <p class="muted small">El personal ve la agenda, los clientes y los chats, pero no puede cambiar servicios, equipo ni ajustes.</p>
        </form>
      </template>
    </template>
  </div>
</template>
