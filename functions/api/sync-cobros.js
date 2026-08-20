// Sincroniza los cobros del dia con la hoja "Cobrado" de la Google Sheet
// "Control de Obra - Horma". Se llama desde Reporte.tsx despues de guardar en
// Supabase, igual que sync-horas.js.
//
// Desde el 20/08/2026 un cobro nuevo puede vivir en DOS lugares segun la obra
// (ver progress/decisiones.md): reportes_cobros (obras sin cuenta por cobrar
// propia) o abonos_cuenta (obras que ya tienen su cuenta - la mayoria, despues
// de la migracion). Esta funcion junta los dos antes de sincronizar, para que
// la planilla no deje de actualizarse silenciosamente para las obras migradas.
//
// A diferencia de "Horas" (upsert por fecha+trabajador), acá no hay una clave
// natural por fila — un mismo dia puede tener varios cobros de la misma obra
// por el mismo monto. Por eso es SOLO AGREGAR: nunca borra ni sobrescribe filas
// existentes (algunas son entradas manuales viejas, previas a esta app, con
// columnas de factura completadas a mano que no hay que tocar). Antes de
// agregar, arma un set de "fecha|monto" ya presentes en la hoja y solo agrega
// las filas de Supabase que no calzan con ese set (si Gustavo vuelve a guardar
// el mismo dia sin cambios, no duplica).

const SHEET_NAME = 'Cobrado'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

export async function onRequestPost(context) {
  const { request, env } = context

  let fecha
  try {
    ;({ fecha } = await request.json())
  } catch {
    return json({ error: 'JSON inválido' }, 400)
  }
  if (!fecha) return json({ error: 'Falta fecha' }, 400)

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY' }, 500)
  }
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.CONTROL_OBRA_SHEET_ID) {
    return json({ error: 'Faltan variables GOOGLE_SERVICE_ACCOUNT_JSON o CONTROL_OBRA_SHEET_ID' }, 500)
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  }

  const [legadoRes, cuentaRes] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/reportes_cobros?select=*&fecha=eq.${fecha}`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/abonos_cuenta?select=fecha,monto,cuentas_por_cobrar(obra,pagador)&fecha=eq.${fecha}`, { headers }),
  ])
  if (!legadoRes.ok || !cuentaRes.ok) return json({ error: 'Error leyendo Supabase' }, 502)
  const cobrosLegado = await legadoRes.json()
  const abonosCuenta = await cuentaRes.json()

  const cobrosDeCuenta = (Array.isArray(abonosCuenta) ? abonosCuenta : [])
    .filter(a => a.cuentas_por_cobrar && a.cuentas_por_cobrar.obra)
    .map(a => ({ fecha: a.fecha, obra: a.cuentas_por_cobrar.obra, cliente: a.cuentas_por_cobrar.pagador, monto: a.monto }))

  const cobros = [...(Array.isArray(cobrosLegado) ? cobrosLegado : []), ...cobrosDeCuenta]
  if (cobros.length === 0) return json({ ok: true, synced: 0 })

  let accessToken
  try {
    accessToken = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON)
  } catch (e) {
    return json({ error: 'Error autenticando con Google: ' + e.message }, 502)
  }

  const spreadsheetId = env.CONTROL_OBRA_SHEET_ID
  const dateSerial = fechaToSerial(fecha)

  const colRes = await sheetsFetch(
    accessToken,
    `${spreadsheetId}/values/${SHEET_NAME}!A2:D3000?valueRenderOption=UNFORMATTED_VALUE`,
    'GET'
  )
  const colVals = colRes.values || []

  let lastRealRow = 1
  const yaSincronizados = new Set() // "fechaSerial|monto"
  colVals.forEach((row, idx) => {
    const sheetRow = idx + 2
    if (row[0] !== undefined && row[0] !== '') lastRealRow = sheetRow
    if (row[0] !== undefined && row[3] !== undefined) yaSincronizados.add(`${row[0]}|${row[3]}`)
  })

  const nuevos = cobros.filter(c => !yaSincronizados.has(`${dateSerial}|${c.monto}`))
  if (nuevos.length === 0) return json({ ok: true, synced: 0 })

  const values = nuevos.map(c => [dateSerial, c.obra || '', c.cliente, c.monto, 'No'])
  await sheetsFetch(accessToken, `${spreadsheetId}/values/${SHEET_NAME}!A${lastRealRow + 1}:E${lastRealRow + values.length}?valueInputOption=USER_ENTERED`, 'PUT', { values })

  return json({ ok: true, synced: values.length })
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function sheetsFetch(accessToken, path, method, body) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Sheets API ${method} ${path} -> ${res.status}: ${await res.text()}`)
  return res.json()
}

function fechaToSerial(fecha) {
  const [y, m, d] = fecha.split('-').map(Number)
  const epoch = Date.UTC(1899, 11, 30)
  const target = Date.UTC(y, m - 1, d)
  return Math.round((target - epoch) / 86400000)
}

async function getGoogleAccessToken(serviceAccountJsonStr) {
  const sa = JSON.parse(serviceAccountJsonStr)
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claims = {
    iss: sa.client_email,
    scope: SHEETS_SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const key = await importPrivateKey(sa.private_key)
  const sigBuffer = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(unsigned)
  )
  const jwt = `${unsigned}.${base64urlFromBuffer(sigBuffer)}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error(JSON.stringify(tokenData))
  return tokenData.access_token
}

function base64url(str) {
  return base64urlFromBuffer(new TextEncoder().encode(str))
}

function base64urlFromBuffer(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function importPrivateKey(pem) {
  const pemContents = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
}
