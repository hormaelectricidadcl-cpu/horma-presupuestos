export async function onRequestPost(context) {
  const { request, env } = context

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { items } = body

  if (!Array.isArray(items) || items.length === 0) {
    return new Response(JSON.stringify({ error: 'Se requiere un array "items" con al menos un ítem' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Falta OPENAI_API_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  // Convertir ítems a lista numerada para que la IA solo asigne fases
  const itemsText = items.map((it, i) => {
    const tipo = it.tipo === 'mano_de_obra' ? 'MO' : 'MAT'
    const cant = Math.max(1, Math.round(Number(it.cantidad) || 1))
    const pu   = Math.round(Number(it.precio_unitario) || 0)
    return `${i}|${tipo}|${String(it.descripcion || '').trim()}|${cant}|${pu}`
  }).join('\n')

  const prompt = `Eres un experto en instalaciones eléctricas chilenas. Clasifica los siguientes ítems en exactamente 4 fases y responde SOLO con JSON válido, sin explicación ni markdown.

FASES FIJAS:
- 1.0 "Preparación y Empalme": medidor, nicho, empalme, tablero de distribución principal
- 2.0 "Canalización y Alimentación": cables, ductos, tuberías, cableado, tendido, materiales complementarios
- 3.0 "Instalaciones y Protecciones": tablero cargador, diferenciales, protecciones, interruptores, montaje de equipos
- 4.0 "Seguridad y Normativa": puesta a tierra, certificación TE1, ingeniería, trámites

ÍTEMS (formato: índice|tipo|descripcion|cantidad|precio_unitario):
${itemsText}

Reglas:
- NO modifiques tipo, cantidad ni precio_unitario — cópialos exactamente
- total = cantidad × precio_unitario
- Sub-numeración: primer ítem de fase 1.0 → "1.1", segundo → "1.2", etc.
- Si un ítem no encaja claramente, asígnalo a la fase más relacionada

FORMATO DE RESPUESTA (JSON array de exactamente 4 objetos):
[
  {
    "numero": "1.0",
    "nombre": "Preparación y Empalme",
    "items": [
      {"subNumero":"1.1","descripcion":"...","cantidad":1,"precioUnitario":100000,"tipo":"MO","total":100000}
    ]
  },
  {"numero":"2.0","nombre":"Canalización y Alimentación","items":[]},
  {"numero":"3.0","nombre":"Instalaciones y Protecciones","items":[]},
  {"numero":"4.0","nombre":"Seguridad y Normativa","items":[]}
]`

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

    const etapasRaw = JSON.parse(textoLimpio)

    const etapas = etapasRaw.map(e => {
      const etapaItems = (e.items || []).map(it => {
        const cantidad       = Math.max(1, Math.round(Number(it.cantidad) || 1))
        const precioUnitario = Math.round(Number(it.precioUnitario) || 0)
        const total          = cantidad * precioUnitario
        return {
          subNumero:      String(it.subNumero || ''),
          descripcion:    String(it.descripcion || '').trim(),
          cantidad,
          precioUnitario,
          tipo:           it.tipo === 'MAT' ? 'MAT' : 'MO',
          total,
        }
      })

      const totalMO  = etapaItems.filter(it => it.tipo === 'MO').reduce((s, it) => s + it.total, 0)
      const totalMAT = etapaItems.filter(it => it.tipo === 'MAT').reduce((s, it) => s + it.total, 0)

      return {
        numero:  String(e.numero || ''),
        nombre:  String(e.nombre || ''),
        items:   etapaItems,
        totalMO,
        totalMAT,
        total: totalMO + totalMAT,
      }
    })

    const totalNeto = etapas.reduce((s, e) => s + e.total, 0)

    return new Response(
      JSON.stringify({ etapas, totalNeto }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
