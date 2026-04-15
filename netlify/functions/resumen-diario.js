/**
 * Netlify Scheduled Function — corre todos los días a las 9am Santiago
 * Schedule en netlify.toml: "0 12 * * *"  (12:00 UTC = 09:00 Chile UTC-3)
 *
 * Manda a Gustavo un WhatsApp con:
 *   1. Trabajos agendados para hoy (fecha_trabajo = hoy)
 *   2. Pendientes sin responder
 */

import { createClient } from '@supabase/supabase-js'

const TIPO_LABELS = {
  confirmar_visita: 'Visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Presupuesto',
  otro: 'Otro',
}

function formatHora(iso) {
  return new Date(iso).toLocaleString('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export async function handler() {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const accountSid  = process.env.TWILIO_ACCOUNT_SID
  const authToken   = process.env.TWILIO_AUTH_TOKEN
  const from        = process.env.TWILIO_WHATSAPP_FROM
  const to          = process.env.GUSTAVO_WHATSAPP
  const token       = process.env.GUSTAVO_TOKEN
  const siteUrl     = process.env.URL || 'https://horma-presupuestos.netlify.app'

  if (!supabaseUrl || !supabaseKey) {
    console.error('resumen-diario: faltan credenciales de Supabase')
    return { statusCode: 500, body: 'Supabase no configurado' }
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  // Rango de hoy en Santiago (UTC-3)
  const ahora = new Date()
  const offsetMs = -3 * 60 * 60 * 1000
  const hoyLocal = new Date(ahora.getTime() + offsetMs)
  const inicioHoy = new Date(Date.UTC(
    hoyLocal.getUTCFullYear(),
    hoyLocal.getUTCMonth(),
    hoyLocal.getUTCDate(),
    3, 0, 0, 0  // 03:00 UTC = 00:00 Santiago UTC-3
  ))
  const finHoy = new Date(inicioHoy.getTime() + 24 * 60 * 60 * 1000)

  // 1. Trabajos agendados para hoy
  const { data: trabajosHoy } = await supabase
    .from('pendientes')
    .select('*')
    .gte('fecha_trabajo', inicioHoy.toISOString())
    .lt('fecha_trabajo', finHoy.toISOString())
    .order('fecha_trabajo', { ascending: true })

  // 2. Pendientes sin responder
  const { data: sinResponder } = await supabase
    .from('pendientes')
    .select('*')
    .in('estado', ['pendiente', 'recordatorio_enviado'])
    .order('fecha_limite', { ascending: true })

  const hayTrabajos  = trabajosHoy?.length > 0
  const hayPendientes = sinResponder?.length > 0

  if (!hayTrabajos && !hayPendientes) {
    console.log('resumen-diario: sin novedades para hoy')
    return { statusCode: 200, body: JSON.stringify({ enviado: false, razon: 'Sin novedades' }) }
  }

  // Armar mensaje
  const link = `${siteUrl}/g?t=${token}`
  const partes = ['☀️ *Resumen del día — Horma*\n']

  if (hayTrabajos) {
    partes.push('🔨 *Trabajos de hoy:*')
    for (const t of trabajosHoy) {
      const hora = formatHora(t.fecha_trabajo)
      partes.push(`  • ${hora} — ${t.cliente_nombre}${t.descripcion ? ` (${t.descripcion.slice(0, 60)})` : ''}`)
    }
    partes.push('')
  }

  if (hayPendientes) {
    partes.push('📋 *Pendientes sin responder:*')
    for (const p of sinResponder) {
      const tipo = TIPO_LABELS[p.tipo] || p.tipo
      partes.push(`  • ${p.cliente_nombre} — ${tipo}`)
    }
    partes.push('')
  }

  partes.push(`👉 ${link}`)

  const mensaje = partes.join('\n')

  if (!accountSid || !authToken || !from || !to) {
    console.log('resumen-diario: Twilio no configurado')
    console.log('Mensaje que se hubiera enviado:\n', mensaje)
    return { statusCode: 200, body: JSON.stringify({ enviado: false, razon: 'Twilio no configurado' }) }
  }

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
      console.error('resumen-diario Twilio error:', err)
      return { statusCode: 200, body: JSON.stringify({ enviado: false, error: err.message }) }
    }

    console.log('resumen-diario: WhatsApp enviado')
    return { statusCode: 200, body: JSON.stringify({ enviado: true }) }
  } catch (err) {
    console.error('resumen-diario error:', err)
    return { statusCode: 200, body: JSON.stringify({ enviado: false, error: String(err) }) }
  }
}
