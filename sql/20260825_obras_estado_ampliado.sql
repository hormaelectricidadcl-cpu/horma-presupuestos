-- Migración para tarea 2.4 de progress/propuesta_arquitectura_operativa.md:
-- estado de obra ampliado (en curso -> terminada en terreno -> facturada -> en garantía ->
-- cerrada), en vez del binario activa/culminada de hoy. Más fecha_inicio, fecha_fin,
-- garantia_hasta.
--
-- Diseño (para no repetir el bug de "dos fuentes de verdad" que ya pasó en este proyecto --
-- ver decisiones.md 2026-08-20, regla "nunca dos números distintos para la misma pregunta"):
-- en vez de agregar estado_obra AL LADO de activa (que podrían desincronizarse si alguien
-- actualiza una sin la otra), `activa` se convierte en columna GENERADA a partir de
-- estado_obra. Todo el código que ya lee `.activa` (ej. el dropdown de obras en Reporte.tsx,
-- que solo debe mostrar obras en curso) sigue funcionando sin cambios -- activa=true si y
-- solo si estado_obra='en_curso', calculado por Postgres, nunca puede quedar desincronizado.
--
-- Backfill: las 3 obras que hoy tienen activa=false (Doctora Eloísa 5843, Luz 2979, Renato
-- Sanchez) quedan en 'cerrada' -- el bucket más genérico de "terminada", porque no hay forma
-- de saber desde acá si cada una está más específicamente "facturada" o "en garantía" sin
-- preguntar. Alexandra puede ajustar cada una a su estado real después, desde la app.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table obras add column estado_obra text not null default 'en_curso'
  check (estado_obra in ('en_curso', 'terminada_terreno', 'facturada', 'en_garantia', 'cerrada'));

update obras set estado_obra = 'cerrada' where activa = false;

alter table obras add column if not exists fecha_inicio date;
alter table obras add column if not exists fecha_fin date;
alter table obras add column if not exists garantia_hasta date;

alter table obras drop column activa;
alter table obras add column activa boolean generated always as (estado_obra = 'en_curso') stored;
