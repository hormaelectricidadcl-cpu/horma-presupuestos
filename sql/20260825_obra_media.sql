-- Migración para tarea 2.5 de progress/propuesta_arquitectura_operativa.md:
-- galería de fotos/videos por obra, para dejar de depender de Google Drive.
--
-- Reusa el bucket de Storage que ya existe (`audio-notas`, ya usado para subir archivos a
-- pendientes) en vez de crear uno nuevo -- mismo principio "reusar antes que inventar" de
-- propuesta_arquitectura_operativa.md. El nombre del bucket quedó desactualizado (ya no es
-- solo audio/notas) pero renombrarlo no cambia nada funcional -- se puede hacer después si
-- Alexandra quiere, no es bloqueante.
--
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists obra_media (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  obra_id uuid not null references obras(id) on delete cascade,
  url text not null,
  tipo text not null check (tipo in ('foto', 'video', 'documento')),
  descripcion text,
  subido_por text
);

alter table obra_media enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token/password de cada panel es el
-- control de acceso real, no RLS.
create policy "anon full access" on obra_media for all to anon using (true) with check (true);
