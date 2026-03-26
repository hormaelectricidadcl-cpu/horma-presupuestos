export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Método no permitido' })
      };
    }

    const { texto } = JSON.parse(event.body || '{}');

    if (!texto || !texto.trim()) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No hay texto para procesar' })
      };
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Falta OPENAI_API_KEY' })
      };
    }

    const prompt = `
Convierte el siguiente texto técnico de presupuesto en un arreglo JSON válido.

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
${texto}
`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        input: prompt,
        temperature: 0
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Error OpenAI:', data);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Error desde OpenAI',
          detalle: data
        })
      };
    }

    const textoRespuesta =
      data.output_text ||
      data.output?.flatMap(item => item.content || [])
        ?.find(content => content.type === 'output_text' || typeof content.text === 'string')
        ?.text ||
      '';

    if (!textoRespuesta || typeof textoRespuesta !== 'string') {
      console.error('Respuesta OpenAI sin texto útil:', data);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'OpenAI no devolvió texto utilizable',
          detalle: data
        })
      };
    }

    let textoLimpio = textoRespuesta.trim();

    const inicioArray = textoLimpio.indexOf('[');
    const finArray = textoLimpio.lastIndexOf(']');

    if (inicioArray !== -1 && finArray !== -1 && finArray > inicioArray) {
      textoLimpio = textoLimpio.substring(inicioArray, finArray + 1);
    }

    let items;
    try {
      items = JSON.parse(textoLimpio);
    } catch (e) {
      console.error('JSON inválido devuelto por OpenAI:', textoRespuesta);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'La IA no devolvió JSON válido',
          bruto: textoRespuesta
        })
      };
    }

    if (!Array.isArray(items)) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'La IA no devolvió un arreglo válido',
          bruto: textoRespuesta
        })
      };
    }

    const itemsNormalizados = items.map((item) => ({
      categoria:
        String(item.categoria || '').toUpperCase() === 'MANO DE OBRA'
          ? 'MANO DE OBRA'
          : 'MATERIALES',
      descripcion: String(item.descripcion || '').trim(),
      cantidad: Number(item.cantidad) > 0 ? Number(item.cantidad) : 1,
      precioUnitario: Number(item.precioUnitario) > 0 ? Number(item.precioUnitario) : 0
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: itemsNormalizados })
    };
  } catch (error) {
    console.error('ERROR parse.js:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: error.message || 'Error interno en parse.js'
      })
    };
  }
}