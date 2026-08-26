export async function onRequestPost(context) {
  const { request, env } = context

  let url
  try {
    ;({ url } = await request.json())
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!url?.trim()) {
    return new Response(JSON.stringify({ error: 'Falta la URL de la captura' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Falta OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const prompt = `Analiza esta captura de pantalla de un comprobante de transferencia o pago bancario.

Reglas obligatorias:
- Responde solo con JSON válido.
- No agregues explicación, títulos ni markdown.
- Formato exacto:

{
  "monto": 10000,
  "fecha": "2026-08-26",
  "destinatario": "nombre de quien recibió el pago",
  "banco": "nombre del banco emisor",
  "numero_operacion": "número de operación o comprobante"
}

- "monto" es el monto final transferido/pagado. Debe ser un número, sin puntos de miles ni símbolo de moneda.
- "fecha" en formato ISO "YYYY-MM-DD" si aparece en la captura, si no usa null.
- "destinatario" es el nombre de la persona o cuenta que recibió el pago, si aparece.
- "banco" es el banco desde el que se hizo la transferencia, si aparece.
- "numero_operacion" es el número de operación/comprobante/folio, si aparece.
- Si algún campo no se puede leer con claridad en la imagen, usa null en ese campo.`

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: url },
            ],
          },
        ],
        temperature: 0,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Error desde OpenAI', detalle: data }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const textoRespuesta = data.output_text ||
      data.output?.flatMap(i => i.content || [])?.find(c => c.type === 'output_text' || typeof c.text === 'string')?.text || ''

    let textoLimpio = textoRespuesta.trim()
    const ini = textoLimpio.indexOf('{')
    const fin = textoLimpio.lastIndexOf('}')
    if (ini !== -1 && fin > ini) textoLimpio = textoLimpio.substring(ini, fin + 1)

    const resultado = JSON.parse(textoLimpio)

    const normalizado = {
      monto: Number(resultado.monto) > 0 ? Number(resultado.monto) : null,
      fecha: String(resultado.fecha || '').trim() || null,
      destinatario: String(resultado.destinatario || '').trim() || null,
      banco: String(resultado.banco || '').trim() || null,
      numero_operacion: String(resultado.numero_operacion || '').trim() || null,
    }

    return new Response(JSON.stringify(normalizado), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
