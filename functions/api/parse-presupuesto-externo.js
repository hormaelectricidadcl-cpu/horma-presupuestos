export async function onRequestPost(context) {
  const { request, env } = context

  let url
  try {
    ;({ url } = await request.json())
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!url?.trim()) {
    return new Response(JSON.stringify({ error: 'Falta la URL del archivo' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Falta OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const prompt = `Analiza este documento de un presupuesto (cotización) de trabajo eléctrico hecho fuera de esta app -- por ejemplo, cargado por Gustavo tal como se lo mandó a un cliente.

Reglas obligatorias:
- Responde solo con JSON válido.
- No agregues explicación, títulos ni markdown.
- Formato exacto:

{
  "monto": 500000,
  "items": [
    {"descripcion": "Instalación de tablero de distribución", "cantidad": 1, "precio_unitario": 100000}
  ]
}

- "monto" es el TOTAL final del presupuesto completo (con IVA incluido si el documento lo muestra así), nunca un subtotal ni el valor de un ítem individual. Debe ser un número, sin puntos de miles ni símbolo de moneda.
- Si el documento tiene varias secciones o etapas con subtotales, "monto" es la suma general / el total final del presupuesto completo.
- Si no se puede leer el monto total con claridad en el documento, usa null.
- "items" es el detalle línea por línea SOLO si el documento realmente lo muestra así (una tabla o lista con ítems, cantidades y precios). Cada ítem: "cantidad" entero (1 si no se especifica), "precio_unitario" el precio de una unidad (no el total de la línea). No inventes ítems ni los inferís de una sola cifra total -- si el documento es solo un monto global sin desglose, devuelve "items": [].`

  // El presupuesto externo puede subirse como PDF o como foto -- la Responses API de
  // OpenAI necesita un content type distinto para cada caso.
  const esPDF = url.toLowerCase().endsWith('.pdf')
  const content = esPDF
    ? [
        { type: 'input_text', text: prompt },
        { type: 'input_file', file_url: url },
      ]
    : [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: url },
      ]

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: [{ role: 'user', content }],
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

    const items = Array.isArray(resultado.items)
      ? resultado.items
          .map(it => {
            const cantidad = Math.max(1, Math.round(Number(it.cantidad) || 1))
            const precioUnitario = Math.round(Number(it.precio_unitario) || 0)
            return {
              descripcion: String(it.descripcion || '').trim(),
              cantidad,
              precio_unitario: precioUnitario,
              total: cantidad * precioUnitario,
            }
          })
          .filter(it => it.descripcion && it.precio_unitario > 0)
      : []

    const normalizado = {
      monto: Number(resultado.monto) > 0 ? Number(resultado.monto) : null,
      items,
    }

    return new Response(JSON.stringify(normalizado), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
