-- SEGURIDAD — ETAPA 1: achicar el daño posible, sin cambiar cómo entra nadie hoy.
-- Conversación abierta desde el 28/08/2026, retomada el 08/09.
--
-- LO QUE SE MIDIÓ (no asumido, comprobado el 08/09):
--   * La clave pública de Supabase está dentro del JS del sitio -- confirmado buscándola en
--     el bundle desplegado. Los tokens de los paneles (Gustavo, reporte, presupuestador)
--     también: los links "privados" están a la vista de cualquiera que abra el código.
--   * Con esa clave, 28 tablas del negocio tienen política ALL / using(true) / check(true):
--     leer, escribir y BORRAR todo, sin pasar por ningún login.
--   * El bucket `audio-notas` se puede enumerar entero con esa misma clave: 123 archivos,
--     con nombres que ya cuentan cosas ("adelanto-Fabriel-...").
--
-- ESTO NO ARREGLA EL FONDO. El fondo es que la base no sabe quién es quién, y eso se
-- resuelve con usuarios reales (etapa 2, sesión aparte). Esto reduce lo que se puede
-- destruir mientras tanto, sin tocar una sola línea de la app.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CERRAR EL LISTADO DEL BUCKET
-- ─────────────────────────────────────────────────────────────────────────────
-- Comprobado antes de escribir esto: los archivos se sirven SIN ninguna clave (el bucket es
-- público, HTTP 200 sin apikey), así que esta política no es la que hace que se vean las
-- fotos. Lo único que habilita es ENUMERAR el bucket con la clave pública.
-- Sacarla: las fotos, comprobantes y boletas se siguen viendo igual desde la app; lo que se
-- corta es que alguien pida la lista completa de archivos.
-- La política de subida (INSERT) no se toca: si se tocara, nadie podría subir nada.

drop policy if exists "allow read audio-notas" on storage.objects;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SACAR EL PERMISO DE BORRAR DONDE LA APP NUNCA BORRA
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoy cada tabla tiene UNA política `ALL`, y ALL incluye DELETE. Se revisó una por una
-- (buscando `.delete()` en todo el código) cuáles borra la app de verdad: borra de 23
-- tablas, y NO borra de las nueve de abajo. En esas nueve, permitir borrado no habilita
-- nada que la app necesite -- solo deja la puerta abierta.
--
-- Son, además, las más difíciles de reconstruir: la asistencia diaria es el historial de
-- nómina, y los comprobantes son la prueba de lo que se pagó.
--
-- Cada bloque reemplaza la política única `ALL` por tres (leer, insertar, actualizar).
-- Efecto en la app: ninguno. Efecto para un tercero con la clave: ya no puede vaciarlas.

do $$
declare t text;
begin
  foreach t in array array[
    'reportes_diarios',           -- asistencia: el historial de nómina
    'pago_semanal_comprobantes',  -- prueba de lo que se pagó cada semana
    'trabajadores',               -- se archivan, nunca se borran
    'cliente_facturas',           -- facturas y boletas emitidas
    'gastos_fijos',
    'materiales',
    'obra_avance_registros',      -- bitácora de avance, append-only por diseño
    'subcontratos_master',
    'pendiente_mensajes'
  ]
  loop
    execute format('drop policy if exists %I on %I', 'anon full access', t);
    execute format('create policy %I on %I for select using (true)', 'anon leer', t);
    execute format('create policy %I on %I for insert with check (true)', 'anon insertar', t);
    execute format('create policy %I on %I for update using (true) with check (true)', 'anon actualizar', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- COMPROBACIÓN — correr después y revisar que diga lo esperado
-- ─────────────────────────────────────────────────────────────────────────────
-- Las nueve tablas tienen que aparecer con SELECT/INSERT/UPDATE y NINGÚN ALL ni DELETE.
select tablename, string_agg(cmd, ', ' order by cmd) as permisos
from pg_policies
where schemaname = 'public'
  and tablename in ('reportes_diarios','pago_semanal_comprobantes','trabajadores','cliente_facturas',
                    'gastos_fijos','materiales','obra_avance_registros','subcontratos_master','pendiente_mensajes')
group by tablename order by tablename;

-- Y el bucket no debe tener ninguna política de SELECT para anon.
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects';

-- ─────────────────────────────────────────────────────────────────────────────
-- MARCHA ATRÁS — solo si algo dejó de funcionar
-- ─────────────────────────────────────────────────────────────────────────────
-- Esto deja todo exactamente como estaba antes. No hace falta correrlo si la comprobación
-- de arriba salió bien y la app anda; está acá para no tener que improvisar si hiciera falta.
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'reportes_diarios','pago_semanal_comprobantes','trabajadores','cliente_facturas',
--     'gastos_fijos','materiales','obra_avance_registros','subcontratos_master','pendiente_mensajes'
--   ]
--   loop
--     execute format('drop policy if exists %I on %I', 'anon leer', t);
--     execute format('drop policy if exists %I on %I', 'anon insertar', t);
--     execute format('drop policy if exists %I on %I', 'anon actualizar', t);
--     execute format('create policy %I on %I for all using (true) with check (true)', 'anon full access', t);
--   end loop;
-- end $$;
--
-- create policy "allow read audio-notas" on storage.objects
--   for select to anon using (bucket_id = 'audio-notas');
