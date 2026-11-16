import { createHmac } from 'crypto';
import { parseMetaWebhook, verifyMetaSignature } from './meta-webhook';
import { toMetaPayload } from './providers/meta-cloud.provider';

const value = (messages: unknown[]) => ({
  entry: [
    {
      changes: [
        {
          field: 'messages',
          value: {
            metadata: { display_phone_number: '+593 99 123 4567', phone_number_id: 'PNID1' },
            contacts: [{ wa_id: '593987654321', profile: { name: 'Ana' } }],
            messages,
          },
        },
      ],
    },
  ],
});

describe('parseMetaWebhook', () => {
  it('extrae texto, local y nombre del cliente', () => {
    const [m] = parseMetaWebhook(
      value([{ from: '593987654321', id: 'wamid.1', timestamp: '1763200000', type: 'text', text: { body: 'hola' } }]),
    );
    expect(m).toMatchObject({
      channel: { waPhoneNumberId: 'PNID1', whatsappNumber: '593991234567' },
      from: '593987654321',
      providerMessageId: 'wamid.1',
      text: 'hola',
      profileName: 'Ana',
    });
  });

  it('extrae el id de botones y listas', () => {
    const msgs = parseMetaWebhook(
      value([
        {
          from: '1',
          id: 'a',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'menu:book', title: 'x' } },
        },
        {
          from: '1',
          id: 'b',
          type: 'interactive',
          interactive: { type: 'list_reply', list_reply: { id: 'svc:3', title: 'x' } },
        },
      ]),
    );
    expect(msgs.map((m) => m.replyId)).toEqual(['menu:book', 'svc:3']);
  });

  it('ignora notificaciones de estado y cuerpos vacíos', () => {
    expect(parseMetaWebhook({ entry: [{ changes: [{ field: 'messages', value: { statuses: [{}] } }] }] })).toEqual([]);
    expect(parseMetaWebhook(undefined)).toEqual([]);
  });
});

describe('verifyMetaSignature', () => {
  const body = Buffer.from('{"a":1}');
  const sig = 'sha256=' + createHmac('sha256', 'secreto').update(body).digest('hex');

  it('acepta una firma válida', () => expect(verifyMetaSignature(body, sig, 'secreto')).toBe(true));
  it('rechaza firma incorrecta, ausente o sin secreto', () => {
    expect(verifyMetaSignature(body, sig, 'otro')).toBe(false);
    expect(verifyMetaSignature(body, undefined, 'secreto')).toBe(false);
    expect(verifyMetaSignature(body, sig, '')).toBe(false);
    expect(verifyMetaSignature(body, 'sha256=abc', 'secreto')).toBe(false);
  });
});

describe('toMetaPayload', () => {
  it('recorta títulos de botones a 20 caracteres y máximo 3 botones', () => {
    const p = toMetaPayload({
      type: 'buttons',
      text: 't',
      buttons: [1, 2, 3, 4].map((i) => ({ id: `${i}`, title: 'Un título demasiado largo' })),
    }) as any;
    expect(p.interactive.action.buttons).toHaveLength(3);
    expect(p.interactive.action.buttons[0].reply.title).toHaveLength(20);
  });
});

describe('toMetaPayload: plantillas', () => {
  it('arma el cuerpo y los botones de respuesta rápida con su payload', () => {
    const p = toMetaPayload({
      type: 'template',
      name: 'confirmar_cita',
      language: 'es',
      bodyParams: ['Ana', 'Corte', 'lunes 16', '10:00'],
      buttonPayloads: ['conf:yes:7', 'conf:no:7'],
    }) as any;
    expect(p.template.name).toBe('confirmar_cita');
    expect(p.template.components[0].parameters).toHaveLength(4);
    expect(p.template.components[2]).toEqual({
      type: 'button',
      sub_type: 'quick_reply',
      index: '1',
      parameters: [{ type: 'payload', payload: 'conf:no:7' }],
    });
  });

  it('el webhook entrega el payload del botón de una plantilla como respuesta', () => {
    const [m] = parseMetaWebhook(
      value([{ from: '1', id: 'c', type: 'button', button: { payload: 'conf:yes:7', text: 'Sí, confirmo' } }]),
    );
    expect(m.replyId).toBe('conf:yes:7');
  });
});
