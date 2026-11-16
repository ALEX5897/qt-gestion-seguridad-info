# Agenda por WhatsApp para peluquerías y centros de estética

Plataforma SaaS (por suscripción) para que peluquerías, barberías y centros de estética de Ecuador
atiendan reservas por WhatsApp de forma automática y controlen su agenda desde el teléfono.

- Cada local tiene **su número de WhatsApp registrado**. Todo cliente que escriba a ese número es
  atendido por el bot de ese local; los números no registrados se ignoran.
- El bot muestra servicios, profesionales, días y horarios libres; reserva, reprograma y cancela.
- Antes de la cita pide **confirmar la asistencia**. Sin respuesta, la cita se cancela y el cupo se
  ofrece a la **fila de espera**, a un cliente a la vez.
- Un **asistente con IA** (Claude) entiende mensajes escritos libremente, recomienda servicios y
  propone horarios reales; además genera **consejos para el dueño** a partir de sus indicadores.
- **Invitación automática a volver** para clientes que llevan tiempo sin venir.
- El dueño maneja todo desde un **panel web instalable en el teléfono** (PWA).
- El **administrador general** da de alta locales, registra pagos y habilita o suspende cuentas.

Plan, decisiones y pendientes: [`docs/PLAN.md`](docs/PLAN.md).

## Qué incluye

| Parte | Contenido |
|---|---|
| `backend/` | API NestJS 11 + Prisma 7 + MySQL: bot, agenda, fila de espera, tareas automáticas, panel y administración |
| `frontend/` | Panel Nuxt 4 (SPA instalable): agenda, chats, clientes, catálogo, bloqueos, ajustes, personal y administración |
| `docs/` | Plan del proyecto y guía para conectar WhatsApp (Meta) |

### Panel del local (dueño y personal)

Agenda por día · citas manuales · confirmar / atendida / no asistió / reprogramar / cancelar ·
chats de WhatsApp con opción de atender en persona · clientes con historial, notas y bloqueo ·
servicios y equipo con horario semanal · bloqueos (feriados, vacaciones) · fila de espera ·
ajustes de reglas · cuentas para el personal · avisos (campana).

### Bot de WhatsApp

Agendar · mis citas · reprogramar · cancelar · confirmar asistencia · anotarse y salir de la fila
de espera · aceptar o rechazar un cupo liberado · pedir hablar con una persona.

## Inteligencia artificial

Es opcional: sin `ANTHROPIC_API_KEY` el sistema funciona igual, solo con botones.

| Función | Qué hace |
|---|---|
| Asistente del bot | Responde mensajes libres ("¿tienen algo mañana en la tarde?", "¿cuánto cuesta el tinte?"), recomienda el servicio adecuado, consulta la agenda real y muestra horarios como botones. Usa la información que el dueño escribe en Ajustes (pagos, parqueadero, promociones). |
| Consejos del negocio | Indicadores de 30 días (ocupación, inasistencias, ingresos, clientes inactivos) y de 3 a 5 recomendaciones concretas generadas con IA. |
| Invitación a volver | Mensaje automático a quien no viene hace N días (no usa IA). Una vez por ciclo, de día, con opción de darse de baja. |

Decisiones de seguridad y costo:

- **La IA nunca reserva, cambia ni cancela.** Solo hace aparecer botones; la acción ocurre cuando el
  cliente los pulsa y pasa por las validaciones normales. Los horarios que propone se verifican
  contra la agenda antes de mostrarse.
- Si la IA falla, declina o se agota el cupo, el cliente recibe el menú de botones de siempre.
- Cupo mensual de respuestas por plan (`Plan.monthlyAiQuota`; 100 en período de prueba). El consumo
  por local se ve en el panel del administrador.
- Los saludos y los botones no consumen IA; solo los mensajes escritos libremente.
- Cada local puede apagar el asistente en Ajustes; `AI_ENABLED=false` lo apaga en toda la plataforma.

## Puesta en marcha

### Con Docker

```bash
cp backend/.env.example backend/.env
docker compose up -d
docker compose exec backend npm run db:seed
```

Panel: <http://localhost:3000> · API: <http://localhost:3001/api>

### Sin Docker (MySQL/MariaDB local)

```bash
cd backend
cp .env.example .env        # ajustar DATABASE_URL
npm install && npx prisma generate && npx prisma db push && npm run db:seed
npm run start:dev           # API en :3001

cd ../frontend
npm install
npm run dev                 # panel en :3000
```

### Usuarios de ejemplo (seed)

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador general | `admin@plataforma.local` | `admin12345` (o `SEED_ADMIN_PASSWORD`) |
| Dueño del local demo | `dueno@demo.local` | `demo12345` |

El local demo usa el número `593990000001`. **Cambia estas contraseñas y `JWT_SECRET` fuera de desarrollo.**

## Probar el bot sin WhatsApp (simulador)

Con `WHATSAPP_PROVIDER=console` el bot responde por la API en lugar de enviar mensajes reales:

```bash
# El cliente escribe "hola" al número del local demo
curl -X POST localhost:3001/api/dev/whatsapp/simulate -H 'content-type: application/json' \
  -d '{"to":"593990000001","from":"593987654321","text":"hola","name":"Ana"}'

# El cliente pulsa un botón: se envía el id que devolvió el paso anterior
curl -X POST localhost:3001/api/dev/whatsapp/simulate -H 'content-type: application/json' \
  -d '{"to":"593990000001","from":"593987654321","replyId":"menu:book"}'

# Ver lo que el sistema envió por su cuenta (recordatorios, ofertas de la fila de espera)
curl 'localhost:3001/api/dev/whatsapp/outbox?phone=593987654321&last=3'

# Simular el paso del tiempo para las tareas automáticas
curl -X POST localhost:3001/api/dev/automation/tick -H 'content-type: application/json' \
  -d '{"now":"2026-12-01T15:00:00Z"}'
```

Para conectarlo a WhatsApp de verdad con el número de prueba gratuito de Meta:
[`docs/WHATSAPP_META.md`](docs/WHATSAPP_META.md).

## Pruebas

```bash
# Unitarias (disponibilidad, suscripciones, webhook, teléfonos)
cd backend && npm test

# De extremo a extremo: base recién sembrada y servidor con
# WHATSAPP_PROVIDER=console AUTOMATION_ENABLED=false
npm run test:e2e

# Funciones de IA contra un Claude simulado (sin clave ni costo):
#   node test/fake-claude.mjs &   y el servidor además con
#   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4010
npm run test:e2e:ai

# De interfaz, en navegador (requiere Playwright): con lo anterior en marcha
cd ../frontend && npm run generate && node test/serve.cjs &   # sirve el panel en :3000
node test/ui.cjs
node test/ui-ai.cjs      # con el Claude simulado en marcha
```

## Publicar el panel

`npm run generate` en `frontend/` produce archivos estáticos en `.output/public`, publicables en
cualquier hosting estático. La URL de la API se define al construir con `NUXT_PUBLIC_API_BASE`.
Para que el teléfono ofrezca "instalar", el panel debe servirse por HTTPS.

## Stack

NestJS 11 · Prisma 7 (adaptador MariaDB) · MySQL 8 · Luxon · Nuxt 4 / Vue 3 · WhatsApp Cloud API ·
Claude (SDK oficial de Anthropic).
