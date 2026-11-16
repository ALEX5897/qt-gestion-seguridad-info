# Conectar el número de prueba gratuito de WhatsApp (Meta)

Meta ofrece un **número de prueba gratuito** para desarrollar con WhatsApp Cloud API. Puede enviar
mensajes a un máximo de **5 números verificados**. Sirve para probar el bot de punta a punta antes
de tener locales reales.

## 1. Crear la app en Meta

1. Entra a <https://developers.facebook.com/> con tu cuenta de Facebook y crea una app de tipo
   **Business**.
2. Agrega el producto **WhatsApp**. Meta crea un número de prueba automáticamente.
3. En **WhatsApp → API Setup** anota:
   - **Phone number ID** → se guarda en el local como `waPhoneNumberId`.
   - El **número de prueba** (formato `1555…`) → se guarda como `whatsappNumber`.
   - El **token de acceso temporal** (dura 24 h; luego crea un token permanente con un
     *System User*).
4. En la misma pantalla agrega tu celular en **"To"** como destinatario verificado (hasta 5).
5. En **App settings → Basic** copia el **App Secret**.

## 2. Configurar el backend

En `backend/.env`:

```env
WHATSAPP_PROVIDER="meta"
META_ACCESS_TOKEN="<token>"
META_APP_SECRET="<app secret>"
META_VERIFY_TOKEN="<cualquier texto secreto que inventes>"
```

## 3. Exponer el webhook

Meta necesita una URL pública HTTPS. En desarrollo puedes usar un túnel gratuito, por ejemplo
`cloudflared tunnel --url http://localhost:3001` o `ngrok http 3001`.

En **WhatsApp → Configuration → Webhook**:

- Callback URL: `https://<tu-túnel>/api/webhooks/whatsapp`
- Verify token: el mismo valor de `META_VERIFY_TOKEN`
- Suscríbete al campo **messages**.

## 4. Registrar el número de prueba como local

Con el token del administrador general:

```bash
curl -X POST localhost:3001/api/admin/tenants \
  -H "authorization: Bearer <TOKEN_SUPERADMIN>" -H 'content-type: application/json' \
  -d '{
    "name": "Mi Peluquería de Prueba",
    "slug": "prueba",
    "whatsappNumber": "<número de prueba sin +>",
    "waPhoneNumberId": "<Phone number ID>",
    "ownerName": "Dueño", "ownerEmail": "dueno@prueba.local", "ownerPassword": "cambiar123"
  }'
```

Escribe "hola" desde tu celular verificado al número de prueba: el bot debe responder con el menú.

## 5. Plantillas para escribir fuera de la ventana de 24 h

WhatsApp solo entrega mensajes normales si el cliente escribió en las últimas 24 h. Los
recordatorios y las ofertas de la fila de espera suelen salir después, así que necesitan
**plantillas aprobadas**. Créalas en **WhatsApp Manager → Plantillas de mensajes** (categoría
*Utility*, idioma español) y pon sus nombres en `backend/.env`.

**Confirmación de asistencia** → `META_TEMPLATE_CONFIRMATION`

> Hola {{1}} 👋 Te recordamos tu cita de {{2}} el {{3}} a las {{4}}. ¿Confirmas tu asistencia?

Botones de respuesta rápida, en este orden: `Sí, confirmo` · `No podré ir`

**Cupo liberado (fila de espera)** → `META_TEMPLATE_WAITLIST`

> Hola {{1}} 🎉 Se liberó un cupo de {{2}} el {{3}} a las {{4}}. Tienes {{5}} minutos para aceptarlo.

Botones de respuesta rápida, en este orden: `Lo quiero` · `No, gracias`

El sistema rellena las variables y asocia cada botón con la cita u oferta correspondiente. Si no
configuras plantillas, se envía el mensaje normal con botones, que solo llega dentro de las 24 h.

> Esta parte no se pudo probar contra Meta en desarrollo (requiere plantillas aprobadas en tu
> cuenta). El formato enviado sigue la documentación de Cloud API y está cubierto por pruebas
> unitarias; verifícalo con tu número de prueba antes de usarlo con clientes.
