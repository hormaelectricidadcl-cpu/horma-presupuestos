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

  const prompt = `Eres un experto en instalaciones eléctricas chilenas. Analiza el siguiente texto de presupuesto y responde SOLO con JSON válido, sin explicación ni markdown.

PASO 1 — EXTRACCIÓN DE ÍTEMS:
Lee cada línea que contenga un precio (número al final, puede tener puntos de miles: "13.000" = 13000).

REGLA CRÍTICA DE CANTIDAD × PRECIO:
- Si la línea EMPIEZA con un número entero (la cantidad), multiplica: total = cantidad × precio_unitario
- Ejemplo: "75 Reemplazo de cable de centros eléctricos 13.000" → cantidad=75, precioUnitario=13000, total=975000
- Ejemplo: "50 ml Cable 2.5mm 800" → cantidad=50, precioUnitario=800, total=40000
- Ejemplo: "2 Tablero distribución 45.000" → cantidad=2, precioUnitario=45000, total=90000
- Si NO empieza con número entero: cantidad=1, precioUnitario=precio_línea, total=precio_línea
- Ejemplo: "Instalación de tablero 100.000" → cantidad=1, precioUnitario=100000, total=100000

Clasifica cada ítem:
- "MO" (mano de obra): instalación, canalización, conexión, certificación, montaje, retiro, reemplazo de trabajo
- "MAT" (materiales): cables, tableros, accesorios, kits, ductos, tuberías, materiales

PASO 2 — AGRUPACIÓN EN 4 FASES FIJAS:
Asigna cada ítem a exactamente una de estas 4 fases:
- 1.0 "Preparación y Empalme": medidor, nichos, empalme, tablero de distribución principal
- 2.0 "Canalización y Alimentación": cables, ductos, tuberías, cableado, tendido, materiales complementarios, accesorios generales de la instalación
- 3.0 "Instalaciones y Protecciones": tablero cargador, montaje equipos, diferenciales, protecciones, interruptores
- 4.0 "Seguridad y Normativa": puesta a tierra, certificación TE1, ingeniería, trámites

Sub-numeración: primer ítem de fase 1.0 → "1.1", segundo → "1.2", etc.
Si un ítem no encaja claramente, asígnalo a la fase más relacionada con el trabajo que describe.
No omitas ningún ítem con precio. Todos los valores son enteros.

FORMATO DE RESPUESTA (JSON array de exactamente 4 objetos):
[
  {
    "numero": "1.0",
    "nombre": "Preparación y Empalme",
    "items": [
      {"subNumero":"1.1","descripcion":"descripción del ítem","cantidad":1,"precioUnitario":100000,"tipo":"MO","total":100000}
    ]
  },
  {"numero":"2.0","nombre":"Canalización y Alimentación","items":[]},
  {"numero":"3.0","nombre":"Instalaciones y Protecciones","items":[]},
  {"numero":"4.0","nombre":"Seguridad y Normativa","items":[]}
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

    const etapasRaw = JSON.parse(textoLimpio)

    const etapas = etapasRaw.map(e => {
      const items = (e.items || []).map(it => {
        const cantidad       = Math.max(1, Math.round(Number(it.cantidad) || 1))
        const precioUnitario = Math.round(Number(it.precioUnitario) || 0)
        const total          = cantidad * precioUnitario
        return {
          subNumero:      String(it.subNumero || ''),
          descripcion:    String(it.descripcion || '').replace(/^\d+[\s.,]+/, '').trim(),
          cantidad,
          precioUnitario,
          tipo:           it.tipo === 'MAT' ? 'MAT' : 'MO',
          total,
        }
      })

      const totalMO  = items.filter(it => it.tipo === 'MO').reduce((s, it) => s + it.total, 0)
      const totalMAT = items.filter(it => it.tipo === 'MAT').reduce((s, it) => s + it.total, 0)

      return {
        numero:  String(e.numero || ''),
        nombre:  String(e.nombre || ''),
        items,
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
