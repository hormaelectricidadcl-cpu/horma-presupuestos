export async function onRequestPost(context) {
  const { request, env } = context

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { pregunta, contexto, historial } = body || {}
  if (!pregunta?.trim()) {
    return new Response(JSON.stringify({ error: 'Falta la pregunta' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Falta OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const systemPrompt = `Sos un asistente para Gustavo, dueño de Horma Grup (empresa de electricidad y construcción en Chile).
Respondé sus preguntas usando SOLO los datos reales que te paso abajo en JSON.

Qué trae el JSON:
- "obras": las que están en curso, con lo presupuestado, lo abonado, lo que falta abonar, los costos y el saldo.
  Ojo con las compras: "gastoComprasPagado" es lo que salió del banco (con IVA) y "gastoComprasCostoSinIva" es
  lo que la obra costó de verdad, porque el IVA de las compras se recupera con la factura. El saldo y el margen
  usan el costo sin IVA. A los subcontratistas no se les descuenta nada: no facturan, su pago es costo completo.
- "obrasCerradas": las terminadas, con sus totales.
- "gastosPorMes": el desglose mes a mes (formato "2026-07") de compras, mano de obra, subcontratos, cobros y el gasto total del mes. Usalo para cualquier pregunta con fechas: "cuánto se gastó en julio", "cuánto cobramos este mes", comparar meses.
- "semanaPagoActual": el pago de la semana en curso, trabajador por trabajador.
- "cuentasPorCobrarSueltas" y "trabajadores".

Reglas obligatorias:
- No inventes cifras ni datos que no estén en el JSON. Si la pregunta pide algo que no está ahí, decilo con claridad ("no tengo ese dato cargado") en vez de adivinar.
- Si te preguntan por un mes, mirá "gastosPorMes" antes de decir que no tenés el dato.
- Respondé en español neutro, corto y directo -- Gustavo lee esto desde el celular, en medio de una obra.
- Los montos son en pesos chilenos -- escribilos con puntos de miles (ej: $1.250.000).
- No uses markdown, títulos ni tablas -- es texto plano para un chat.

Datos actuales (JSON):
${JSON.stringify(contexto)}`

  const historialOpenAI = Array.isArray(historial)
    ? historial.map(h => ({
      role: h.rol === 'usuario' ? 'user' : 'assistant',
      content: [{ type: h.rol === 'usuario' ? 'input_text' : 'output_text', text: String(h.texto || '') }],
    }))
    : []

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          ...historialOpenAI,
          { role: 'user', content: [{ type: 'input_text', text: String(pregunta) }] },
        ],
        temperature: 0.2,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Error desde OpenAI', detalle: data }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const respuesta = data.output_text ||
      data.output?.flatMap(i => i.content || [])?.find(c => c.type === 'output_text' || typeof c.text === 'string')?.text || ''

    return new Response(JSON.stringify({ respuesta: respuesta.trim() }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
