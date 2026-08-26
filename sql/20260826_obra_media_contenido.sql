-- Extiende `obra_media` (creada en sql/20260825_obra_media.sql) para soportar el "banco de
-- contenido" de marketing: fotos/video geolocalizados que suben Fabriel/Misael desde la obra,
-- con etiqueta de momento, autorización del cliente para usarlo en redes, y un marcador de
-- destacado para que Alexandra pueda curar rápido.
--
-- Todo nullable salvo los booleans con default -- no rompe los inserts existentes de
-- `GaleriaObra` (que hoy solo manda obra_id/url/tipo).
--
-- Pegar en Supabase → SQL Editor → Run.

alter table obra_media add column if not exists lat numeric;
alter table obra_media add column if not exists lng numeric;
alter table obra_media add column if not exists momento text check (momento in ('antes', 'durante', 'despues'));
alter table obra_media add column if not exists autorizado_cliente boolean not null default false;
alter table obra_media add column if not exists destacado boolean not null default false;
