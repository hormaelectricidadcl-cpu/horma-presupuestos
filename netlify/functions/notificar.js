/**
 * POST /.netlify/functions/notificar
 * Body: { clienteNombre, tipo, fechaLimite }
 *
 * Envía un WhatsApp a Gustavo via Twilio cuando se crea un nuevo pendiente.
 * Si Twilio no está configurado, responde OK sin enviar (no bloquea el flujo).
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
  const from       = process.env.TWILIO_WHATSAPP_FROM   // whatsapp:+14155238886
  const to         = process.env.GUSTAVO_WHATSAPP        // whatsapp:+569XXXXXXXX
  const token      = process.env.GUSTAVO_TOKEN
  const siteUrl    = process.env.URL || 'https://horma-presupuestos.netlify.app'

  // If Twilio not configured yet, silently skip
  if (!accountSid || !authToken || !from || !to) {
    console.log('notificar: Twilio no configurado, omitiendo envío')
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, whatsapp: false, razon: 'Twilio no configurado' }),
    }
  }

  let clienteNombre, tipo, fechaLimite
  try {
    ;({ clienteNombre, tipo, fechaLimite } = JSON.parse(event.body || '{}'))
  } catch {
    return { statusCode: 400, body: 'JSON inválido' }
  }

  const tipoTexto = TIPO_LABELS[tipo] || tipo

  const fecha = new Date(fechaLimite).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  const link = `${siteUrl}/g?t=${token}`

  const mensaje = `🔔 *Pendiente nuevo*\n\n👤 ${clienteNombre}\n📌 ${tipoTexto}\n⏰ Antes del ${fecha}\n\n👉 ${link}`

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
    console.error('notificar error:', err)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, whatsapp: false, error: String(err) }),
    }
  }
}
