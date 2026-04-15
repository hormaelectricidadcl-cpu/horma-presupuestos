/**
 * POST /.netlify/functions/notificar-respuesta
 * Body: { clienteNombre, tipo, respuesta }
 *
 * Envía un WhatsApp a Alexandra cuando Gustavo responde un pendiente.
 * Si Twilio no está configurado, responde OK sin enviar.
 */

const TIPO_LABELS = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Revisar',
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken  = process.env.TWILIO_AUTH_TOKEN
  const from       = process.env.TWILIO_WHATSAPP_FROM
  const to         = process.env.ALEXANDRA_WHATSAPP

  if (!accountSid || !authToken || !from || !to) {
    console.log('notificar-respuesta: Twilio no configurado, omitiendo')
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, whatsapp: false, razon: 'Twilio no configurado' }),
    }
  }

  let clienteNombre, tipo, respuesta
  try {
    ;({ clienteNombre, tipo, respuesta } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: 'JSON inválido' }
  }

  const tipoTexto = TIPO_LABELS[tipo] || tipo
  const siteUrl = process.env.URL || 'https://horma-presupuestos.netlify.app'
  const adminLink = `${siteUrl}/admin`

  // Truncar respuesta larga para el mensaje
  const resumenRespuesta = respuesta && respuesta.length > 200
    ? respuesta.slice(0, 200) + '...'
    : respuesta || '(sin texto)'

  const mensaje = `✅ *Gustavo respondió*\n\n👤 ${clienteNombre}\n📌 ${tipoTexto}\n\n💬 ${resumenRespuesta}\n\n👉 ${adminLink}`

  const body = new URLSearchParams({ From: from, To: to, Body: mensaje })

  try {
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
        body: body.toString(),
      }
    )

    if (!resp.ok) {
      const err = await resp.json()
      console.error('Twilio error:', err)
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, whatsapp: false, error: err.message }),
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, whatsapp: true }),
    }
  } catch (err) {
    console.error('notificar-respuesta error:', err)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, whatsapp: false, error: String(err) }),
    }
  }
}
