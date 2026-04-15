/**
 * Netlify Scheduled Function — corre cada 2 horas
 * Schedule definido en netlify.toml: "0 *\/2 * * *"
 *
 * Revisa pendientes sin responder que:
 *   - están por vencer (en las próximas 2h) o ya vencieron
 *   - no tuvieron recordatorio en las últimas 4h
 * Y envía un WhatsApp de alerta a Gustavo.
 */

import { createClient } from '@supabase/supabase-js'

const TIPO_LABELS = {
  confirmar_visita: 'Confirmar visita',
  revisar_fotos: 'Revisar fotos',
  presupuesto: 'Ingresar presupuesto',
  otro: 'Revisar',
}

export async function handler() {
  const supabaseUrl     = process.env.SUPABASE_URL
  const supabaseKey     = process.env.SUPABASE_SERVICE_ROLE_KEY
  const accountSid      = process.env.TWILIO_ACCOUNT_SID
  const authToken       = process.env.TWILIO_AUTH_TOKEN
  const from            = process.env.TWILIO_WHATSAPP_FROM
  const to              = process.env.GUSTAVO_WHATSAPP
  const token           = process.env.GUSTAVO_TOKEN
  const siteUrl         = process.env.URL || 'https://horma-presupuestos.netlify.app'

  if (!supabaseUrl || !supabaseKey) {
    console.error('recordatorio: faltan credenciales de Supabase')
    return { statusCode: 500, body: 'Supabase no configurado' }
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const ahora      = new Date()
  const en2horas   = new Date(ahora.getTime() + 2 * 60 * 60 * 1000)
  const hace4horas = new Date(ahora.getTime() - 4 * 60 * 60 * 1000)

  // Buscar pendientes activos que:
  // 1. Vencen en las próximas 2h (o ya vencieron)
  // 2. No tuvieron recordatorio en las últimas 4h
  const { data: pendientes, error } = await supabase
    .from('pendientes')
    .select('*')
    .in('estado', ['pendiente', 'recordatorio_enviado'])
    .lte('fecha_limite', en2horas.toISOString())
    .or(`recordatorio_enviado_at.is.null,recordatorio_enviado_at.lte.${hace4horas.toISOString()}`)

  if (error) {
    console.error('recordatorio: error Supabase:', error)
    return { statusCode: 500, body: error.message }
  }

  if (!pendientes?.length) {
    console.log('recordatorio: sin pendientes urgentes')
    return { statusCode: 200, body: JSON.stringify({ enviados: 0 }) }
  }

  let enviados = 0

  for (const p of pendientes) {
    const vencido    = new Date(p.fecha_limite) < ahora
    const estadoTxt  = vencido ? '🚨 VENCIDO' : '⚠️ Por vencer'
    const tipoTexto  = TIPO_LABELS[p.tipo] || p.tipo

    const fecha = new Date(p.fecha_limite).toLocaleString('es-CL', {
      timeZone: 'America/Santiago',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

    const link    = `${siteUrl}/g?t=${token}`
    const mensaje = `${estadoTxt} *Pendiente sin respuesta*\n\n👤 ${p.cliente_nombre}\n📌 ${tipoTexto}\n⏰ ${fecha}\n\n👉 ${link}`

    // Solo enviar WhatsApp si Twilio está configurado
    if (accountSid && authToken && from && to) {
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
        if (resp.ok) enviados++
        else console.error('Twilio error para', p.id, await resp.text())
      } catch (err) {
        console.error('recordatorio fetch error:', err)
      }
    }

    // Actualizar estado en Supabase siempre (registro del intento)
    await supabase
      .from('pendientes')
      .update({
        estado: 'recordatorio_enviado',
        recordatorio_enviado_at: ahora.toISOString(),
      })
      .eq('id', p.id)
  }

  console.log(`recordatorio: ${enviados} WhatsApp enviados de ${pendientes.length} pendientes`)
  return {
    statusCode: 200,
    body: JSON.stringify({ enviados, total: pendientes.length }),
  }
}
