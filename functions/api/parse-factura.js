export async function onRequestPost(context) {
  const { request, env } = context

  let url
  try {
    ;({ url } = await request.json())
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!url?.trim()) {
    return new Response(JSON.stringify({ error: 'Falta la URL de la foto' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Falta OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const prompt = `Analiza esta foto de una boleta o factura de compra de materiales.

Reglas obligatorias:
- Responde solo con JSON válido.
- No agregues explicación, títulos ni markdown.
- Formato exacto:

{
  "descripcion": "resumen breve de los materiales comprados, separados por coma",
  "monto": 10000,
  "items": [
    { "descripcion": "nombre del material o producto", "cantidad": 1, "precioUnitario": 5000 }
  ]
}

- "monto" es el TOTAL final pagado en la boleta (con IVA incluido si corresponde), no un subtotal. Debe ser un número, sin puntos de miles ni símbolo de moneda.
- "descripcion" es un resumen corto y legible de los materiales principales (ej: "Cable 10mm, cajas octogonales, cinta aislante").
- "items" es la lista de cada línea/material que aparece en la boleta por separado. Cada ítem:
  - "cantidad": el número de unidades compradas de ese material. Si no aparece explícito, usa 1.
  - "precioUnitario": el precio de una sola unidad de ese material, sin puntos de miles.
  - Si la boleta solo muestra un precio total por línea (no unitario) y la cantidad es 1, "precioUnitario" es ese mismo precio.
- Si no se puede leer el monto con claridad en la imagen, usa null en "monto".
- Si no se distinguen ítems individuales en la boleta (ej. una boleta genérica sin desglose), "items" puede ser un arreglo vacío [].`

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

    const itemsNormalizados = Array.isArray(resultado.items)
      ? resultado.items
        .filter(it => String(it.descripcion || '').trim())
        .map(it => ({
          descripcion: String(it.descripcion || '').trim(),
          cantidad: Number(it.cantidad) > 0 ? Number(it.cantidad) : 1,
          precioUnitario: Number(it.precioUnitario) > 0 ? Number(it.precioUnitario) : 0,
        }))
      : []

    const normalizado = {
      descripcion: String(resultado.descripcion || '').trim(),
      monto: Number(resultado.monto) > 0 ? Number(resultado.monto) : null,
      items: itemsNormalizados,
    }

    return new Response(JSON.stringify(normalizado), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
