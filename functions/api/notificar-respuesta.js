const TIPO_LABELS = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Revisar',
  emitir_boleta: 'Emitir boleta',
  emitir_factura: 'Emitir factura',
  cobro: 'Cobro pendiente',
}

export async function onRequestPost(context) {
  const { request, env } = context

  const accountSid = env.TWILIO_ACCOUNT_SID
  const authToken  = env.TWILIO_AUTH_TOKEN
  const from       = env.TWILIO_WHATSAPP_FROM
  const to         = env.ALEXANDRA_WHATSAPP
  const siteUrl    = 'https://horma-presupuestos.pages.dev'

  if (!accountSid || !authToken || !from || !to) {
    return new Response(JSON.stringify({ ok: true, whatsapp: false, razon: 'Twilio no configurado' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let clienteNombre, tipo, respuesta, destinatario
  try {
    ;({ clienteNombre, tipo, respuesta, destinatario } = await request.json())
  } catch {
    return new Response('JSON inválido', { status: 400 })
  }

  const tipoTexto = TIPO_LABELS[tipo] || tipo
  const quien = destinatario === 'irazu' ? 'Irazú' : 'Gustavo'
  const adminLink = `${siteUrl}/admin`
  const resumen = respuesta && respuesta.length > 200 ? respuesta.slice(0, 200) + '...' : respuesta || '(sin texto)'

  const mensaje = `✅ *${quien} respondió*\n\n👤 ${clienteNombre}\n📌 ${tipoTexto}\n\n💬 ${resumen}\n\n👉 ${adminLink}`

  const body = new URLSearchParams({ From: from, To: to, Body: mensaje })

  try {
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      },
      body: body.toString(),
    })
    return new Response(JSON.stringify({ ok: true, whatsapp: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ ok: true, whatsapp: false, error: String(err) }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
