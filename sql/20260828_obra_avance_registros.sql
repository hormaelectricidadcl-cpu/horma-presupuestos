-- "Bitácora de avance diario por obra" -- Fase 1 (ver progress/decisiones.md, entrada
-- 2026-08-28 "Bitácora de avance diario reemplaza el UPDATE directo de cantidad_completada").
--
-- Alexandra pidió que el avance quede fechado por día y por trabajador (no solo el estado
-- actual), para tres usos futuros: detectar atraso real vs. planificado y su costo en
-- sueldos pagados de más, respaldo para renegociar con clientes, y eventualmente bonos por
-- terminar antes de lo estimado. Esta migración cubre solo la base de datos de Fase 1
-- (bitácora + trigger); el costo en plata (Fase 2) y las reglas de bono (Fase 3) quedan
-- pendientes de definir con Alexandra, no son solo decisiones técnicas.
--
-- Diseño: `obra_avance_registros` es append-only -- cada carga desde campo (o corrección
-- desde Gustavo/Alexandra) es una fila nueva con un delta (`cantidad_avanzada`, puede ser
-- negativo para corregir un exceso cargado por error). `obra_items.cantidad_completada`
-- deja de escribirse directo desde el frontend -- pasa a ser un campo cacheado, mantenido
-- por un trigger que lo recalcula desde la suma de la bitácora, mismo mecanismo ya usado
-- en este proyecto para `materiales.stock_actual` desde `movimientos_stock`
-- (sql/20260825_stock_materiales.sql) -- así nunca puede desincronizarse del historial real.
--
-- Mismo patrón "anon full access" de siempre: el token de cada panel es el control de
-- acceso real, no RLS.
--
-- Pegar en Supabase → SQL Editor → Run.

create table if not exists obra_avance_registros (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  obra_id uuid not null references obras(id) on delete cascade,
  item_id uuid not null references obra_items(id) on delete cascade,
  fecha date not null default current_date,
  cantidad_avanzada numeric not null,
  trabajador text,
  nota text
);

create index if not exists idx_obra_avance_registros_item_id on obra_avance_registros(item_id);
create index if not exists idx_obra_avance_registros_obra_id on obra_avance_registros(obra_id);

alter table obra_avance_registros enable row level security;

create policy "anon full access" on obra_avance_registros for all to anon using (true) with check (true);

-- Trigger: cada insert o delete en la bitácora recalcula cantidad_completada del ítem
-- afectado como la suma de todos sus registros, nunca menos que 0 (una corrección negativa
-- no puede dejar el avance en números rojos). Se recalcula con SUM en vez de sumar/restar
-- el delta a mano para que quede correcto también al borrar un registro cargado por error.
create or replace function actualizar_cantidad_completada_item()
returns trigger as $$
declare
  target_item_id uuid;
begin
  target_item_id := coalesce(new.item_id, old.item_id);
  update obra_items
  set cantidad_completada = greatest(0, (
    select coalesce(sum(cantidad_avanzada), 0)
    from obra_avance_registros
    where item_id = target_item_id
  ))
  where id = target_item_id;
  return coalesce(new, old);
end;
$$ language plpgsql;

create trigger trg_actualizar_cantidad_completada
after insert or delete on obra_avance_registros
for each row execute function actualizar_cantidad_completada_item();
