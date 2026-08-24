#!/usr/bin/env bash
# Verificación de integridad del arnés — correr al inicio de sesión si hay dudas,
# o antes de dar cualquier tarea por terminada. No asumir que un archivo existe
# ni que el proyecto compila sin correr esto primero.
set -u
cd "$(dirname "$0")"

fail=0
check() {
  if [ ! -f "$1" ]; then
    echo "FALTA: $1"
    fail=1
  fi
}

echo "== Arnés =="
check "CLAUDE.md"

echo "== Progreso (lectura obligatoria) =="
check "progress/estado_actual.md"
check "progress/decisiones.md"
check "progress/tareas.md"

echo "== Roles de agente (formato real, auto-descubierto por Claude Code) =="
check ".claude/agents/estratega-horma.md"
check ".claude/agents/constructor-horma.md"
check ".claude/agents/revisor-horma.md"

echo "== Config local =="
check ".env"

echo "== Type-check (no solo que exista, que compile) =="
if [ -d "src" ] && [ -f "node_modules/typescript/bin/tsc" ]; then
  if (cd src && node ../node_modules/typescript/bin/tsc --noEmit -p .. > /tmp/horma_tsc_out.txt 2>&1); then
    echo "OK — tsc --noEmit sin errores"
  else
    echo "FALLÓ tsc --noEmit — ver detalle:"
    cat /tmp/horma_tsc_out.txt
    fail=1
  fi
else
  echo "AVISO: no se encontró src/ o node_modules/typescript — ¿corriste npm install?"
  fail=1
fi

echo ""
echo "== Límite conocido, no es una falla =="
echo "Las funciones de functions/api/*.js (Cloudflare Pages Functions) NO se pueden"
echo "probar acá — no hay wrangler/pages dev instalado, solo Vite. Cualquier cambio"
echo "ahí queda sin verificar en local hasta que se prueba en producción."

echo ""
if [ "$fail" -eq 0 ]; then
  echo "OK — arnés íntegro y el proyecto compila."
else
  echo "ATENCIÓN — algo falló arriba. No asumir que el proyecto está en buen estado."
fi
exit $fail
