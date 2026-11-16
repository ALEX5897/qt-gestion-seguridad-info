/**
 * Servidor que imita la API de Claude con respuestas guionizadas, para probar la
 * integración (SDK real, herramientas, manejo de errores) sin clave ni costo.
 * No evalúa la calidad de las respuestas del modelo: eso requiere el modelo real.
 *
 * Uso: node test/fake-claude.mjs   (puerto 4010)
 * y el backend con ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4010
 */
import http from 'node:http';

const PORT = Number(process.env.FAKE_CLAUDE_PORT ?? 4010);
const requests = [];
const threads = new Map();
let seq = 0;

const message = (content, stop_reason = 'end_turn') => ({
  id: `msg_fake_${++seq}`,
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content,
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 1200, output_tokens: 80 },
});
const text = (t) => message([{ type: 'text', text: t }]);
const call = (name, input) => message([{ type: 'tool_use', id: `toolu_fake_${++seq}`, name, input }], 'tool_use');

function respond(body) {
  // Consejos para el dueño: salida estructurada, sin herramientas.
  if (!body.tools?.length) {
    const metrics = body.messages[0].content;
    return text(
      JSON.stringify({
        resumen: `Análisis de prueba. ${/"total": (\d+)/.exec(metrics)?.[1] ?? '0'} citas en el período.`,
        consejos: [
          { titulo: 'Llena las mañanas', por_que: 'Las mañanas tienen menos citas.', accion: 'Ofrece un horario de mañana a quien pregunte.', impacto: 'alto' },
          { titulo: 'Recupera clientes', por_que: 'Hay clientes inactivos.', accion: 'Activa la invitación a volver a los 30 días.', impacto: 'medio' },
          { titulo: 'Reduce inasistencias', por_que: 'Hubo inasistencias.', accion: 'Mantén el recordatorio 24 h antes.', impacto: 'bajo' },
        ],
      }),
    );
  }

  const system = body.system.map((b) => b.text).join('\n');
  const first = body.messages[0].content;
  const customer = /<mensaje_del_cliente>\n([\s\S]*?)\n<\/mensaje_del_cliente>/.exec(first)?.[1] ?? '';
  const today = /\((\d{4}-\d{2}-\d{2})\)/.exec(first)?.[1];
  const date = /\d{4}-\d{2}-\d{2}/.exec(customer)?.[0] ?? today;
  const service = (name) => Number(new RegExp(`"id": (\\d+),\\s*"nombre": "${name}"`).exec(system)?.[1]);
  const serviceId = /tinte/i.test(customer) ? service('Tinte') : service('Corte de cabello');

  // Último intercambio de herramienta, si lo hay.
  const last = body.messages.at(-1);
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
  const prevCall = body.messages.at(-2)?.content?.find?.((b) => b.type === 'tool_use');
  const resultText = results.map((r) => (typeof r.content === 'string' ? r.content : r.content?.map((c) => c.text).join(''))).join('\n');

  if (/error500/.test(customer)) return { __status: 500 };
  if (/rechazo/.test(customer)) return message([], 'refusal');

  if (!results.length) {
    if (/precio|cu[aá]nto/i.test(customer)) return call('ofrecer_accion', { accion: 'agendar', servicio_id: serviceId });
    if (/persona/i.test(customer)) return call('pasar_a_persona', { motivo: 'El cliente pide hablar con el personal' });
    if (/inventa/i.test(customer)) return call('proponer_horarios', { servicio_id: serviceId, opciones: ['p1-1000000000000', 'basura'] });
    if (/ajena/i.test(customer)) return call('ofrecer_accion', { accion: 'gestionar_cita', cita_id: 1 });
    if (/horario|fila|tarde/i.test(customer)) {
      return call('consultar_disponibilidad', { servicio_id: serviceId, fecha: date, ...(/tarde/i.test(customer) ? { desde: '15:00' } : {}) });
    }
    return text('Con gusto te ayudo. ¿Qué servicio te interesa?');
  }

  if (prevCall?.name === 'consultar_disponibilidad') {
    const data = JSON.parse(resultText);
    if (data.total_libres > 0) {
      return call('proponer_horarios', { servicio_id: serviceId, opciones: data.horarios.slice(0, 3).map((h) => h.opcion) });
    }
    return call('ofrecer_accion', { accion: 'fila_de_espera', servicio_id: serviceId, fecha: date });
  }
  if (prevCall?.name === 'proponer_horarios') {
    return text(resultText.startsWith('Error') ? 'Déjame revisar otra vez la agenda. ¿Qué día prefieres?' : 'Tengo estos horarios para ti. Elige el que prefieras 👇');
  }
  if (prevCall?.name === 'pasar_a_persona') return text('Claro, alguien del equipo te responderá por este chat en breve.');
  if (prevCall?.name === 'ofrecer_accion') {
    if (prevCall.input.accion === 'fila_de_espera') return text('Ese día está completo. Si quieres, te aviso apenas se libere un cupo.');
    if (resultText.startsWith('Error')) return text('No encuentro esa cita entre las tuyas.');
    return text('El corte de cabello cuesta $8.00 y dura 30 minutos. ¿Te reservo?');
  }
  return text('¿En qué más te ayudo?');
}

http
  .createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/_requests') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(requests));
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const sent = JSON.parse(raw || '{}');
      // Hilos de mensajes: en los turnos de continuación el SDK envía solo los mensajes nuevos,
      // sin `system` ni `tools`; el servidor conserva la conversación, igual que la API real.
      let body = sent;
      if (sent.thread?.type === 'continue') {
        const prev = threads.get(sent.thread.previous_message_id);
        if (!prev) {
          res.writeHead(404, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ type: 'error', error: { type: 'thread_not_found', message: 'hilo desconocido' } }));
        }
        body = { ...prev, messages: [...prev.messages, ...sent.messages] };
      }
      requests.push({ url: req.url, beta: req.headers['anthropic-beta'] ?? null, body, sent });
      const out = respond(body);
      if (!out.__status) {
        threads.set(out.id, { ...body, messages: [...body.messages, { role: 'assistant', content: out.content }] });
      }
      if (out.__status) {
        res.writeHead(out.__status, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'fallo simulado' } }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  })
  .listen(PORT, () => console.log(`Claude simulado en :${PORT}`));
