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

  const prompt = `Analiza este documento (boleta o factura) ya emitido por Horma Grup a un cliente (electricidad/construcción).

Reglas obligatorias:
- Responde solo con JSON válido.
- No agregues explicación, títulos ni markdown.
- Formato exacto:

{
  "monto": 125446,
  "fecha": "2026-09-01",
  "rut": "77.713.725-5",
  "razon_social": "Mga abogados ltda",
  "giro": "Servicios jurídicos",
  "direccion": "Guardia vieja 255, Providencia"
}

- "monto" es el TOTAL final del documento (con IVA incluido si corresponde), nunca el neto/subtotal. Número, sin puntos de miles ni símbolo de moneda.
- "fecha" es la fecha de emisión en formato ISO "YYYY-MM-DD", si aparece.
- "rut", "razon_social", "giro" y "direccion" son los datos del RECEPTOR (el cliente al que se le emite, no los de Horma Grup) -- una boleta simple puede no traer ninguno de estos, en ese caso usa null en todos.
- Si algún campo no se puede leer con claridad en el documento, usa null en ese campo.`

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

    const normalizado = {
      monto: Number(resultado.monto) > 0 ? Number(resultado.monto) : null,
      fecha: String(resultado.fecha || '').trim() || null,
      rut: String(resultado.rut || '').trim() || null,
      razon_social: String(resultado.razon_social || '').trim() || null,
      giro: String(resultado.giro || '').trim() || null,
      direccion: String(resultado.direccion || '').trim() || null,
    }

    return new Response(JSON.stringify(normalizado), { headers: { 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
}
