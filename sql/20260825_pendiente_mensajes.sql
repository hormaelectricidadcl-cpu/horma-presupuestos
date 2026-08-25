-- Migración para tarea 2.10 de progress/propuesta_arquitectura_operativa.md:
-- varias interacciones por pendiente -- hoy `pendientes.respuesta` es un solo campo de texto,
-- pero en la práctica hay ida y vuelta entre Gustavo y Alexandra antes de que quede claro qué
-- acción tomar. Alexandra confirmó (25/08) que lo quiere como un hilo tipo chat.
--
-- Diseño: tabla nueva, aparte de `pendientes.respuesta`/`estado` -- no se toca ese mecanismo
-- existente (que sigue siendo "la respuesta final" + "marcar resuelto"), para no arriesgar
-- romper el flujo diario ya en uso. El hilo es un agregado: mensajes de ida y vuelta que se
-- pueden sumar sin cerrar el pendiente.
--
-- Pegar en Supabase → SQL Editor → Run.

create table pendiente_mensajes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pendiente_id uuid not null references pendientes(id) on delete cascade,
  autor text not null check (autor in ('gustavo', 'irazu')),
  texto text not null
);

alter table pendiente_mensajes enable row level security;

-- Mismo modelo de confianza que el resto de la app: el token/password de cada panel es el
-- control de acceso real, no RLS.
create policy "anon full access" on pendiente_mensajes for all to anon using (true) with check (true);
