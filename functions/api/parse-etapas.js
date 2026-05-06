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

  const prompt = `Eres un experto en instalaciones eléctricas. Analiza el texto de presupuesto y distribuye todos los ítems con precio en exactamente 4 fases de obra. Suma los montos (mano de obra + materiales) que correspondan a cada fase. Responde SOLO con JSON válido, sin explicación ni markdown.

Las 4 fases y sus criterios:
- Fase 1.0 "Preparación y Empalme": medidor, empalme, tablero de distribución principal y sus materiales.
- Fase 2.0 "Canalización y Alimentación": canalización, cableado, ductos, tuberías y sus materiales.
- Fase 3.0 "Montaje y Protecciones": tablero del cargador, diferencial, equipo EV/cargador y sus materiales.
- Fase 4.0 "Ingeniería y Certificación": TE1, puesta a tierra, ingeniería, certificación, trámites.

Reglas:
- Suma todos los ítems de cada fase (tanto MO como materiales). Si un ítem no encaja claramente, asígnalo a la fase más cercana.
- Si una fase no tiene ítems, pon total 0.
- "descripcion" es un resumen breve (máx 80 chars) de lo incluido.
- Los totales son números enteros sin puntos de miles ni símbolo $.
- Los totales de las 4 fases deben sumar exactamente el total de todos los ítems del texto.

Formato de respuesta:
[
  {"numero": "1.0", "nombre": "Preparación y Empalme", "descripcion": "Texto breve", "total": 0},
  {"numero": "2.0", "nombre": "Canalización y Alimentación", "descripcion": "Texto breve", "total": 0},
  {"numero": "3.0", "nombre": "Montaje y Protecciones", "descripcion": "Texto breve", "total": 0},
  {"numero": "4.0", "nombre": "Ingeniería y Certificación", "descripcion": "Texto breve", "total": 0}
]

Texto del presupuesto:
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

    const etapas = JSON.parse(textoLimpio)

    const etapasNormalizadas = etapas.map(e => ({
      numero: String(e.numero || ''),
      nombre: String(e.nombre || ''),
      descripcion: String(e.descripcion || ''),
      total: Math.round(Number(e.total) || 0),
    }))

    return new Response(JSON.stringify({ etapas: etapasNormalizadas }), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
