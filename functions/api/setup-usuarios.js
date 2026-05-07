// Endpoint de uso único para crear los 3 usuarios autorizados del presupuestador.
// Protegido con clave de admin. Llamar UNA VEZ: GET /api/setup-usuarios?key=horma2026
// Después de ejecutarlo, se puede dejar tal cual (si el usuario ya existe Supabase retorna error 422, no crea duplicados).

const USUARIOS = [
  { email: 'Boss29931@gmail.com',          password: 'HormaB@ss2026#9'  },
  { email: 'irazugr@gmail.com',            password: 'HormaIr@zu2026#3' },
  { email: 'hormaelectricidadcl@gmail.com', password: 'H0rmaElec2026#7'  },
]

export async function onRequestGet(context) {
  const { request, env } = context
  const url    = new URL(request.url)
  const key    = url.searchParams.get('key')
  const adminP = env.ADMIN_PASSWORD

  if (!adminP || key !== adminP) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }

  const supabaseUrl     = env.SUPABASE_URL
  const serviceRoleKey  = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Faltan variables SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY' }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  const resultados = []

  for (const usuario of USUARIOS) {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        email:         usuario.email,
        password:      usuario.password,
        email_confirm: true,
      }),
    })

    const data = await res.json()
    resultados.push({
      email: usuario.email,
      ok:    res.ok,
      // No retornar el password en la respuesta
      resultado: res.ok ? 'Creado correctamente' : (data.msg || data.error || JSON.stringify(data)),
    })
  }

  return new Response(JSON.stringify({ resultados }, null, 2), { headers: { 'Content-Type': 'application/json' } })
}
