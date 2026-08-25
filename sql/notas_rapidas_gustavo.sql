-- Migración para tarea 1.3 de progress/propuesta_arquitectura_operativa.md:
-- que Gustavo tenga su propia lista de notas rápidas (recordatorios personales tipo
-- "comprar cable 10mm en Obra X", los tacha él mismo cuando los resuelve), separada de la de
-- Alexandra pero con el mismo componente/tabla -- reusando `notas_rapidas`, que ya existía
-- solo para Alexandra en /admin.
--
-- Decisión de diseño (conversación 25/08): esto NO se mete dentro del sistema de "pendientes"
-- (que es para tareas donde una persona le pide algo a la OTRA y espera respuesta) porque acá
-- Gustavo suele ser quien anota Y quien resuelve -- se parece más a un checklist personal
-- (mismo patrón que apps como Todoist/Trello: nota-a-mí-mismo = tarea autoasignada, no un
-- pedido formal a otra persona). Si en un caso puntual sí necesita que Alexandra actúe
-- activamente (ella tiene que comprarlo, no él), ahí sigue siendo mejor un pendiente normal
-- con destinatario='irazu' -- las dos herramientas conviven.
--
-- Ojo: `autor` con default 'alexandra' es intencional, no un valor arbitrario -- todas las
-- filas que existen hoy fueron creadas por ella (la tabla solo se usaba en /admin), así que el
-- backfill es correcto, no una adivinanza.
--
-- Aparte, de paso: esta tabla tenía RLS deshabilitado del todo (hallazgo del advisor de
-- Supabase, sesión 25/08) -- se cierra acá mismo ya que se está tocando la tabla, con el mismo
-- patrón "anon full access" que usa el resto de la app (el token/password de cada panel es el
-- control de acceso real, no RLS).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table notas_rapidas add column if not exists autor text not null default 'alexandra'
  check (autor in ('alexandra', 'gustavo'));

alter table notas_rapidas enable row level security;

create policy "anon full access" on notas_rapidas for all to anon using (true) with check (true);
