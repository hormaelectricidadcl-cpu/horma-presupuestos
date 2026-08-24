# CLAUDE.md — Horma App
> Arnés de este proyecto. OBLIGATORIO: leer progress/estado_actual.md antes de empezar cualquier tarea. Si algo se siente roto, correr `bash init.sh` antes de asumir que un archivo existe.

## Qué es
Presupuestador + panel Admin/Gustavo para Horma Electricidad. React 19 + TS + Supabase, en producción en **Cloudflare Pages** (`horma-presupuestos.pages.dev`) — el `netlify.toml` sigue en el repo por historia pero el deploy real NO es Netlify, ojo con eso.

## Por qué importa hacerlo bien — no re-litigar
Los cálculos de Estado de Resultados / Cuentas por Cobrar / Pago semanal / saldos por obra determinan **pagos reales** a Gustavo, trabajadores y subcontratistas. Un bug acá no es cosmético — hace que alguien reciba de más o de menos. Por eso el criterio siempre es: verificar contra datos reales antes de dar algo por bueno, nunca asumir que el código "se ve bien" y ya.

## Cómo alimenta el flywheel
Demuestra capacidad técnica full-stack real → caso de estudio para agencias España (ver `E:\ALEXANDRA TRABAJO\CLAUDE.md`, tabla de proyectos verificables).

## Roles de agente disponibles
Subagents reales en `.claude/agents/` (Claude Code los auto-descubre, no hace falta leerlos a mano):
- Planificar / decidir → `estratega-horma`
- Construir / implementar → `constructor-horma`
- Verificar / revisar → `revisor-horma`

## Progreso y estado
- **Estado actual → progress/estado_actual.md** (leer PRIMERO en cada sesión)
- Decisiones ya tomadas → progress/decisiones.md (no re-litigar)
- Tareas pendientes → progress/tareas.md

## Cómo verificar (la parte que más importa)
1. **Type-check, siempre:** desde `src/`, correr `node ../node_modules/typescript/bin/tsc --noEmit -p ..` (el binario `tsc` normal no anda directo por cómo está restringido el directorio de trabajo acá). Cero errores antes de dar cualquier cambio por terminado.
2. **Dinero real → verificar contra Supabase, no solo leer el código.** MCP `supabase-horma` (solo lectura, project-ref `fhcebphnvnozaxherpbf`). Antes de tocar Estado de Resultados / Cuentas por Cobrar / Pago semanal / cualquier obra, correr el cálculo a mano contra los datos reales y comparar.
3. **UI en navegador:** el panel de Gustavo (`/g?t=VITE_GUSTAVO_TOKEN`, valor en `.env`) valida el token en el cliente y SÍ se puede probar con Vite local (`npm run dev`). El panel de Admin (`/admin`) pide contraseña vía una Cloudflare Pages Function que NO corre bajo Vite plano — no se puede probar Admin.tsx en vivo así. Como la mayoría de la lógica financiera vive en el módulo compartido `src/components/PanelesObra.tsx`, probar por el panel de Gustavo alcanza para casi todo.
4. **Cloudflare Functions (`functions/api/*.js`) no se pueden probar en local** — no hay `wrangler`/`pages dev` instalado, solo Vite. Cualquier función nueva ahí queda sin verificar hasta que se prueba en producción. Decirlo explícitamente al reportar el trabajo, no asumir que "probablemente funciona".

## Cosas que ya se aprendieron a la mala — no repetir
- **Dos sistemas de "plata que deben los clientes" coexisten a propósito:** `cuentas_por_cobrar`+`abonos_cuenta` (manual, para cargos sueltos tipo PSG/Ignacio) y `obras.presupuesto_total`+`reportes_cobros` (automático, alimentado por el Reporte Diario). La pestaña "Cuentas por cobrar" muestra ambos combinados, sin duplicar — ver decisiones.md 2026-08-20.
- **La planilla "Control de Obra - Horma" tiene entradas manuales viejas** (antes de que existiera esta app) con columnas completadas a mano — cualquier sync automático a Sheets tiene que ser solo-agregar, nunca borrar/pisar filas existentes.
- **`git push` puede fallar con 403 aunque el repo esté bien** — Windows tiene varias cuentas de GitHub cacheadas y puede usar la incorrecta. Ver memoria `reference_git_push_wrong_github_account`.
- Fabriel tiene sueldo fijo mensual (no tarifa diaria) — cualquier cálculo "por día trabajado" tiene que excluirlo explícitamente o va a mostrar una plata inventada.

## Reglas del arnés
1. progress/estado_actual.md = primera lectura obligatoria de cada sesión
2. Anotar avances en progress/estado_actual.md al terminar la sesión
3. Decisiones importantes → progress/decisiones.md (para no repetir el mismo debate)
4. El criterio final es de Alexandra y Gustavo — la IA propone, ellos deciden
5. No marcar una tarea de plata como "verificada" sin haber corrido la consulta real contra Supabase
