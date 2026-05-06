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

  const prompt = `Eres un experto en instalaciones eléctricas. Procesa el siguiente texto de presupuesto en 2 pasos y responde SOLO con JSON válido, sin explicación ni markdown.

PASO 1 — Lee CADA línea que tenga un número de precio. Los precios pueden tener puntos de miles (ej: "100.000" = 100000).

REGLA CRÍTICA DE CANTIDAD × PRECIO: Si una línea empieza con un número entero que representa una CANTIDAD (ejemplo: "75 Reemplazo de cable 13.000"), calcula el monto como CANTIDAD × PRECIO_UNITARIO (75 × 13.000 = 975.000). El primer número es cantidad cuando: es un número entero, aparece antes de la descripción, y el último número de la línea es el precio unitario. Nunca uses solo el precio unitario ignorando la cantidad.

Ejemplos de multiplicación:
- "75 Reemplazo de cable de centros eléctricos 13.000" → monto = 75 × 13000 = 975000
- "50 ml Cable 2.5mm 800" → monto = 50 × 800 = 40000
- "2 Tablero distribución 45.000" → monto = 2 × 45000 = 90000
- "Instalación de tablero 100.000" → monto = 100000 (sin cantidad al inicio)

Clasifica cada ítem como "MO" (mano de obra: instalación, canalización, conexión, certificación, montaje) o "MAT" (materiales: tableros, cables, accesorios, kits, porcentajes de materiales). No omitas ningún ítem con precio.

PASO 2 — Agrupa todos los ítems en exactamente 5 fases. Para cada fase, suma los montos MO por separado y los MAT por separado:

Fase 1.0 "Preparación y Empalme": ítems del medidor, empalme, tablero de distribución principal y sus materiales.
Fase 2.0 "Canalización y Alimentación": ítems de canalización, cableado, ductos, tuberías y sus materiales.
Fase 3.0 "Montaje y Protecciones": tablero del cargador, instalación del cargador, diferencial EV y sus materiales.
Fase 4.0 "Ingeniería y Certificación": TE1, puesta a tierra, certificación, trámites de ingeniería.
Fase 5.0 "Imprevistos y Complementarios": porcentajes de imprevistos, materiales complementarios, contingencias.

Reglas críticas:
- Los totales de MO+MAT de las 5 fases deben sumar exactamente el total de todos los ítems del texto.
- Si un ítem no encaja en ninguna fase, asígnalo a la Fase 5.0.
- "total" = manoObra + materiales (siempre).
- "descripcion" es un resumen breve (máx 70 chars) de lo incluido.
- Todos los valores son números enteros sin puntos.

Formato de respuesta:
[
  {"numero":"1.0","nombre":"Preparación y Empalme","descripcion":"","manoObra":0,"materiales":0,"total":0},
  {"numero":"2.0","nombre":"Canalización y Alimentación","descripcion":"","manoObra":0,"materiales":0,"total":0},
  {"numero":"3.0","nombre":"Montaje y Protecciones","descripcion":"","manoObra":0,"materiales":0,"total":0},
  {"numero":"4.0","nombre":"Ingeniería y Certificación","descripcion":"","manoObra":0,"materiales":0,"total":0},
  {"numero":"5.0","nombre":"Imprevistos y Complementarios","descripcion":"","manoObra":0,"materiales":0,"total":0}
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

    const etapasNormalizadas = etapas.map(e => {
      const mo  = Math.round(Number(e.manoObra)  || 0)
      const mat = Math.round(Number(e.materiales) || 0)
      return {
        numero:      String(e.numero || ''),
        nombre:      String(e.nombre || ''),
        descripcion: String(e.descripcion || ''),
        manoObra:    mo,
        materiales:  mat,
        total:       mo + mat,
      }
    })

    // Compute grand total for validation info
    const grandTotal = etapasNormalizadas.reduce((s, e) => s + e.total, 0)

    return new Response(
      JSON.stringify({ etapas: etapasNormalizadas, totalNeto: grandTotal }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
