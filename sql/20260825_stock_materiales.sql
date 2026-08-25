-- Migración para tarea 3.3 de progress/propuesta_arquitectura_operativa.md, paso 3:
-- stock real de materiales -- catálogo + movimientos (entra por compra marcada "Stock", sale
-- cuando Gustavo usa material guardado en una obra puntual).
--
-- Diseño importante: `stock_actual` NO se actualiza a mano desde el código -- un trigger de
-- Postgres lo recalcula solo cada vez que se inserta o se borra un movimiento. Mismo principio
-- que ya se usó con `obras.activa` (columna generada): que la base de datos garantice que el
-- número nunca se desincroniza, en vez de confiar en que el código de la app siempre lo
-- actualice bien. Un movimiento mal cargado se puede borrar y el stock se corrige solo.
--
-- Pegar en Supabase → SQL Editor → Run.

create table materiales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nombre text not null unique,
  unidad text,
  stock_actual numeric not null default 0
);

create table movimientos_stock (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  material_id uuid not null references materiales(id) on delete cascade,
  tipo text not null check (tipo in ('entrada', 'salida')),
  cantidad numeric not null check (cantidad > 0),
  fecha date not null,
  -- Solo tiene sentido para 'salida' -- en qué obra se usó.
  obra text,
  -- Solo tiene sentido para 'entrada' -- de qué compra vino. `on delete cascade` a propósito:
  -- el Reporte Diario borra y vuelve a crear las compras del día completo cada vez que se
  -- reenvía (para poder editarlo) -- si el movimiento de stock no se borrara junto con su
  -- compra, reenviar el mismo día dos veces duplicaría la entrada al stock. Con cascade, se
  -- borra el movimiento viejo (el trigger revierte el stock) y se crea uno nuevo limpio.
  compra_id uuid references reportes_compras(id) on delete cascade,
  nota text
);

alter table materiales enable row level security;
alter table movimientos_stock enable row level security;

create policy "anon full access" on materiales for all to anon using (true) with check (true);
create policy "anon full access" on movimientos_stock for all to anon using (true) with check (true);

-- Trigger: cada movimiento nuevo ajusta el stock del material correspondiente.
create or replace function actualizar_stock_material()
returns trigger as $$
begin
  if new.tipo = 'entrada' then
    update materiales set stock_actual = stock_actual + new.cantidad where id = new.material_id;
  else
    update materiales set stock_actual = stock_actual - new.cantidad where id = new.material_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_actualizar_stock
after insert on movimientos_stock
for each row execute function actualizar_stock_material();

-- Trigger: si se borra un movimiento (ej. se cargó mal), el stock se revierte solo.
create or replace function revertir_stock_material()
returns trigger as $$
begin
  if old.tipo = 'entrada' then
    update materiales set stock_actual = stock_actual - old.cantidad where id = old.material_id;
  else
    update materiales set stock_actual = stock_actual + old.cantidad where id = old.material_id;
  end if;
  return old;
end;
$$ language plpgsql;

create trigger trg_revertir_stock
after delete on movimientos_stock
for each row execute function revertir_stock_material();
