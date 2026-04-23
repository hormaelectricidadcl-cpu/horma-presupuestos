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
  const siteUrl    = 'https://horma-presupuestos.pages.dev'

  let clienteNombre, tipo, fechaLimite, destinatario
  try {
    ;({ clienteNombre, tipo, fechaLimite, destinatario } = await request.json())
  } catch {
    return new Response('JSON inválido', { status: 400 })
  }

  // Determinar destinatario del WhatsApp
  const esIrazu = destinatario === 'irazu'
  const to      = esIrazu ? env.IRAZU_WHATSAPP : env.GUSTAVO_WHATSAPP
  const token   = esIrazu ? env.VITE_IRAZU_TOKEN : env.GUSTAVO_TOKEN
  const nombre  = esIrazu ? 'Irazú' : 'Gustavo'
  const path    = esIrazu ? 'i' : 'g'

  if (!accountSid || !authToken || !from || !to) {
    return new Response(JSON.stringify({ ok: true, whatsapp: false }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const tipoTexto = TIPO_LABELS[tipo] || tipo
  const fecha = new Date(fechaLimite).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })

  const link = `${siteUrl}/${path}?t=${token}`
  const mensaje = `🔔 *Pendiente nuevo para ${nombre}*\n\n👤 ${clienteNombre}\n📌 ${tipoTexto}\n⏰ Antes del ${fecha}\n\n👉 ${link}`

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
