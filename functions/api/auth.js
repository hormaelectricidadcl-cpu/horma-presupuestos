export async function onRequestPost(context) {
  const { request, env } = context

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { password, token } = body

  // Verificar token de sesión (recarga de página)
  if (token) {
    const ok = !!(env.ADMIN_SESSION_TOKEN && token === env.ADMIN_SESSION_TOKEN)
    return new Response(JSON.stringify({ ok }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verificar contraseña
  if (password) {
    const ok = !!(env.ADMIN_PASSWORD && password === env.ADMIN_PASSWORD)
    if (ok) {
      return new Response(
        JSON.stringify({ ok: true, token: env.ADMIN_SESSION_TOKEN }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    return new Response(JSON.stringify({ ok: false }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: false }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  })
}
