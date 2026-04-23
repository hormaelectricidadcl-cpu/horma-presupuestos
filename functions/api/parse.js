export async function onRequestPost(context) {
  const { request, env } = context

  let texto
  try {
    ;({ texto } = await request.json())
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  if (!texto?.trim()) {
    return new Response(JSON.stringify({ error: 'No hay texto para procesar' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Falta OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const prompt = `Convierte el siguiente texto técnico de presupuesto en un arreglo JSON válido.

Reglas obligatorias:
- Responde solo con JSON válido.
- No agregues explicación, títulos ni markdown.
- Devuelve exclusivamente un arreglo JSON.
- Cada línea representa un ítem.
- Si una línea comienza con un número, ese número es la cantidad.
- Si no aparece cantidad, usar 1.
- Si aparece "c/u", el valor indicado es precio unitario.
- Si no aparece "c/u", asumir que el valor es precio unitario del ítem.
- El campo "precioUnitario" debe ser número sin puntos de miles.
- El campo "cantidad" debe ser número.
- Clasifica "categoria" únicamente como "MATERIALES" o "MANO DE OBRA".
- Usa "MATERIALES" para equipos, insumos o productos físicos.
- Usa "MANO DE OBRA" para instalación, armado, configuración, reemplazo, montaje, canalización, alambrado, revisión o diagnóstico.
- Mantén siglas técnicas como NVR.
- Corrige ortografía básica en la descripción.
- IMPORTANTE: Si un ítem NO tiene precio explícito en el texto, NO lo incluyas. Solo incluye ítems con un valor numérico de precio claramente mencionado.
- Formato exacto:

[
  {
    "categoria": "MATERIALES",
    "descripcion": "Texto",
    "cantidad": 1,
    "precioUnitario": 10000
  }
]

Texto:
${texto}`

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt, temperature: 0 }),
    })

    const data = await response.json()

    if (!response.ok) {
      return new Response(JSON.stringify({ error: 'Error desde OpenAI', detalle: data }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    }

    const textoRespuesta = data.output_text ||
      data.output?.flatMap(i => i.content || [])?.find(c => c.type === 'output_text' || typeof c.text === 'string')?.text || ''

    let textoLimpio = textoRespuesta.trim()
    const ini = textoLimpio.indexOf('[')
    const fin = textoLimpio.lastIndexOf(']')
    if (ini !== -1 && fin > ini) textoLimpio = textoLimpio.substring(ini, fin + 1)

    const items = JSON.parse(textoLimpio)

    const itemsNormalizados = items
      .filter(item => Number(item.precioUnitario) > 0)
      .map(item => ({
        categoria: String(item.categoria || '').toUpperCase() === 'MANO DE OBRA' ? 'MANO DE OBRA' : 'MATERIALES',
        descripcion: String(item.descripcion || '').trim(),
        cantidad: Number(item.cantidad) > 0 ? Number(item.cantidad) : 1,
        precioUnitario: Number(item.precioUnitario),
      }))

    return new Response(JSON.stringify({ items: itemsNormalizados }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
