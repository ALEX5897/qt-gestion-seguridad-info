# Plan del proyecto

## 1. Decisiones tomadas

| Tema | Decisión |
|---|---|
| Canal de WhatsApp | **WhatsApp Cloud API de Meta en modo desarrollo** (número de prueba gratuito, hasta 5 destinatarios verificados) y un **simulador local**. Con clientes reales: número propio de cada local verificado en Meta. |
| ¿Quién tiene servicio? | Solo los **locales suscritos**. Se registra el número del local; cualquier cliente que escriba a ese número es atendido por ese local. Números no registrados: se ignoran. Local suspendido o vencido: un aviso neutro por cliente cada 24 h. |
| País | **Ecuador**: zona `America/Guayaquil`, moneda USD, teléfonos locales (`099…`) convertidos a `593…`, Ley Orgánica de Protección de Datos Personales (LOPDP). |
| Costos al inicio | Solo herramientas gratuitas. Los pagos de suscripción se registran **manualmente** (transferencia, depósito, efectivo). Más adelante: pasarela (PayPhone, Kushki o Datafast). |
| Fila de espera | El cupo liberado se ofrece **de uno en uno por orden de llegada**, con tiempo límite (15 min por defecto). Mientras la oferta está vigente el cupo queda reservado. |
| Panel del dueño | Aplicación web instalable en el teléfono (PWA). |
| Tareas automáticas | Un proceso cada minuto que **lee la base de datos** (sin Redis ni colas). Es más simple y gratis, y no pierde nada si el servidor se reinicia. Si el volumen crece, se puede migrar a BullMQ. |

### Sobre las librerías no oficiales (Baileys, whatsapp-web.js)

Son gratuitas pero violan los términos de WhatsApp y el número puede ser **bloqueado de forma
permanente**. El código trabaja contra una interfaz `WhatsAppProvider` (hoy: simulador y Meta Cloud
API); el número de prueba de Meta ya es gratuito, así que no hacen falta para desarrollar.

### Costos de WhatsApp en producción

- Responder dentro de las 24 h desde el último mensaje del cliente: sin plantilla.
- Escribir fuera de esa ventana (recordatorios, ofertas de la fila de espera) exige **plantillas
  aprobadas por Meta** y tiene costo por mensaje. El sistema ya las usa si están configuradas
  (`META_TEMPLATE_CONFIRMATION`, `META_TEMPLATE_WAITLIST`); ver `docs/WHATSAPP_META.md`.
- El consumo mensual por local se ve en el panel del administrador (`Plan.monthlyMessageQuota`).

## 2. Arquitectura

```
Cliente WhatsApp ─► Meta Cloud API ─webhook─► API NestJS ─► MySQL
                                                  │
        InboundService: identifica el local por el número → descarta duplicados
          → verifica suscripción → registra cliente → BotService
                                                  │
     SchedulingService (disponibilidad) · BookingService (reservas sin doble agenda)
     WaitlistService (ofertas de a uno) · AutomationService (cada minuto)
                                                  │
                    Panel Nuxt (PWA): dueño, personal y administrador general
```

- **Multi-local**: toda tabla de negocio tiene `tenantId`; cada dueño solo ve lo suyo.
- **Fechas en UTC**, zona horaria por local.
- **Webhooks**: firma de Meta verificada e idempotencia por `MessageLog.providerMessageId`.
- **Sin doble reserva**: bloqueo `SELECT … FOR UPDATE` del profesional y verificación de cruces
  (citas, bloqueos y cupos ofrecidos) en transacción READ COMMITTED.

## 3. Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Reglas de negocio, esquema de datos, decisiones | ✅ |
| 1 | Backend base, login con roles, administración de locales y pagos manuales | ✅ |
| 1b | Panel web del administrador general | ✅ |
| 2 | Panel del dueño (PWA): agenda, citas manuales, catálogo, horarios, bloqueos, clientes, chats, ajustes, personal, avisos | ✅ |
| 3 | Bot: agendar, mis citas, cancelar, hablar con una persona | ✅ |
| 3b | Bot: reprogramar, fila de espera | ✅ |
| 4 | Confirmación de asistencia, cancelación automática sin respuesta, ofertas a la fila de espera, avisos al dueño | ✅ |
| 5 | Límite de profesionales por plan, consumo de mensajes, vencimiento con días de gracia | ✅ |
| 5b | **Cobro automático con pasarela** (PayPhone/Kushki) | ⏳ requiere cuenta de comercio |
| 6 | **Piloto con 2–3 locales reales** | ⏳ requiere números reales verificados en Meta |
| 7 | Reportes, anticipos, encuestas, IA conversacional, notificaciones push | futuro |

## 4. Reglas configurables por local

| Campo | Defecto | Significado |
|---|---|---|
| `slotStepMinutes` | 15 | Cada cuánto se ofrecen horarios |
| `minAdvanceMinutes` | 60 | Anticipación mínima para reservar |
| `maxAdvanceDays` | 30 | Hasta cuántos días adelante se puede reservar |
| `reminderHoursBefore` | 24 | Cuándo pedir confirmación de asistencia |
| `confirmationTimeoutMinutes` | 240 | Sin respuesta en este tiempo (o al llegar la hora de la cita) → se cancela |
| `waitlistOfferMinutes` | 15 | Tiempo para aceptar un cupo liberado |

La duración se define por servicio, con ajuste opcional por profesional y tiempo de limpieza.
Una cita reservada con menos anticipación que `reminderHoursBefore` nace confirmada.

## 5. Suscripciones

- Local nuevo: período de prueba (14 días por defecto, hasta 3 profesionales).
- Registrar un pago extiende la suscripción desde su vencimiento y reactiva el local.
- Al vencer hay días de gracia (5); después el bot deja de atender y el dueño ve un aviso.
- El administrador puede suspender o reactivar en cualquier momento.

## 6. Cumplimiento (LOPDP, Ecuador)

- El bot muestra un aviso de privacidad en el primer contacto y registra `Customer.optInAt`.
- Pendiente: redactar el aviso definitivo con asesoría legal y un procedimiento para eliminar los
  datos de un cliente que lo solicite.

## 7. Pendientes conocidos

- **Antes de producción**: cambiar contraseñas del seed y `JWT_SECRET`; usar migraciones con
  historial (`prisma migrate`) en lugar de `db push`; restringir CORS al dominio del panel;
  crear y aprobar las plantillas en Meta.
- Una cuenta de personal desactivada conserva su sesión hasta que expire el token (12 h).
- Los bloqueos no cancelan las citas ya agendadas en ese rango: se revisan a mano en la agenda.
- Los avisos al dueño aparecen dentro del panel (se actualizan cada 30 s); aún no hay notificaciones
  push con la app cerrada.
- El consumo de mensajes se muestra pero no se bloquea al superar el cupo del plan.
