-- Migración para tarea 1.2 de progress/propuesta_arquitectura_operativa.md:
-- que los trabajos puntuales que Gustavo hace solo (visitas técnicas cobradas, arreglos
-- chicos sin obra asociada) sumen a Estado de Resultados en vez de quedar fuera del cálculo.
--
-- Nullable a propósito: los trabajos puntuales ya cargados no tienen monto y no se puede
-- inventar un número retroactivo — quedan en $0 hasta que alguien los complete a mano si hace falta.
--
-- Pegar en Supabase → SQL Editor → Run.

alter table reportes_trabajos_puntuales add column if not exists monto numeric;
