// Sincroniza el Reporte Diario (Supabase) con la hoja "Horas" de la Google Sheet
// "Control de Obra - Horma". Se llama desde Reporte.tsx después de guardar en Supabase.
// No bloquea ni reemplaza a Supabase — Supabase sigue siendo la fuente de verdad,
// esto solo empuja una copia a la planilla para que Gustavo no tenga que transcribir nada.

const SHEET_NAME = 'Horas'
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

  const supaRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/reportes_diarios?select=*&fecha=eq.${fecha}&order=trabajador`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  )
  if (!supaRes.ok) return json({ error: 'Error leyendo Supabase' }, 502)
  const rows = await supaRes.json()
  const presentes = (Array.isArray(rows) ? rows : []).filter(r => r.presente)

  if (presentes.length === 0) return json({ ok: true, synced: 0 })

  let accessToken
  try {
    accessToken = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_JSON)
  } catch (e) {
    return json({ error: 'Error autenticando con Google: ' + e.message }, 502)
  }

  const spreadsheetId = env.CONTROL_OBRA_SHEET_ID
  const dateSerial = fechaToSerial(fecha)

  // Leer toda la columna A y B para encontrar filas existentes de esta fecha (upsert)
  // y encontrar la última fila real con datos (de ahí se copian las fórmulas H:N).
  const colRes = await sheetsFetch(
    accessToken,
    `${spreadsheetId}/values/${SHEET_NAME}!A2:B3000`,
    'GET'
  )
  const colVals = colRes.values || []

  let lastRealRow = 1 // fila de header = 1, si no hay datos empezamos en fila 2
  const existingRowByWorker = new Map() // trabajador -> número de fila (1-based en la hoja)
  colVals.forEach((row, idx) => {
    const sheetRow = idx + 2
    if (row[0] !== undefined && row[0] !== '') lastRealRow = sheetRow
    if (Number(row[0]) === dateSerial && row[1]) existingRowByWorker.set(row[1], sheetRow)
  })

  const formulaTemplate = await sheetsFetch(
    accessToken,
    `${spreadsheetId}/values/${SHEET_NAME}!H${lastRealRow}:N${lastRealRow}?valueRenderOption=FORMULA`,
    'GET'
  )
  const templateFormulas = (formulaTemplate.values && formulaTemplate.values[0]) || []

  const updates = []
  let nextNewRow = lastRealRow + 1

  for (const r of presentes) {
    const targetRow = existingRowByWorker.get(r.trabajador) || nextNewRow
    if (!existingRowByWorker.has(r.trabajador)) nextNewRow += 1

    const formulas = templateFormulas.length
      ? templateFormulas.map(f => f.replace(new RegExp(String(lastRealRow), 'g'), String(targetRow)))
      : []

    updates.push({
      range: `${SHEET_NAME}!A${targetRow}:N${targetRow}`,
      values: [[
        dateSerial,
        r.trabajador,
        r.obra || '',
        r.fraccion_jornada,
        '',
        '',
        r.adelanto_monto || '',
        ...formulas,
      ]],
    })
  }

  await sheetsFetch(accessToken, `${spreadsheetId}/values:batchUpdate`, 'POST', {
    valueInputOption: 'USER_ENTERED',
    data: updates,
  })

  return json({ ok: true, synced: updates.length })
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
