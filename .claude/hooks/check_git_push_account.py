#!/usr/bin/env python3
"""Avisa si el remote de git no tiene la cuenta correcta antes de un `git push`.

Por que existe: el 20/08/2026 un `git push` real fallo con 403 durante 2 dias
(12+ commits atascados solo en el disco local) porque Windows tenia varias
cuentas de GitHub cacheadas y usaba por defecto una sin permiso sobre este
repo. Se resolvio apuntando el remote a `https://hormaelectricidadcl-cpu@
github.com/...` explicitamente (el username en la URL fuerza que el
credential manager pida esa cuenta puntual). Esta era una regla de texto en
CLAUDE.md ("Cosas que ya se aprendieron a la mala") que depende de que
alguien se acuerde de mirar el remote antes de pushear -> ahora es un chequeo
deterministico que corre solo antes de cualquier `git push`.

Disenado para NUNCA bloquear un push: solo avisa si el remote no tiene el
username esperado. Cualquier error (git no encontrado, remote no configurado,
JSON invalido, etc.) se traga y termina en exit 0.
"""
import json
import re
import subprocess
import sys

EXPECTED_ACCOUNT = "hormaelectricidadcl-cpu"


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    command = ((data.get("tool_input") or {}).get("command") or "")
    if not re.search(r"\bgit\s+push\b", command):
        return 0

    try:
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        remote_url = (result.stdout or "").strip()
        if not remote_url:
            return 0

        if EXPECTED_ACCOUNT not in remote_url:
            print(
                f"[hook] aviso: el remote 'origin' no incluye '{EXPECTED_ACCOUNT}' en la URL "
                f"({remote_url}). Si este push falla con 403, es probablemente la cuenta de "
                "GitHub cacheada equivocada en Windows (ya paso una vez, 20/08/2026) - "
                "ver progress/decisiones.md o CLAUDE.md."
            )
    except Exception:
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
