# Sistema de Pendientes — Horma Electricidad

## Resumen del sistema

Aplicación interna para gestionar la comunicación entre Alexandra (administración) y Gustavo (técnico en terreno). Vive en el mismo repo que el presupuestador original.

**URL producción:** https://horma-presupuestos.netlify.app

| Ruta | Quién la usa | Qué hace |
|---|---|---|
| `/` | Todos | Presupuestador original (sin cambios) |
| `/admin` | Alexandra (desktop) | Panel de gestión de pendientes |
| `/g?t=TOKEN` | Gustavo (iPhone) | Vista móvil para responder pendientes |

---

## Stack técnico

- **Frontend:** React 19 + Vite 7 + TypeScript (strict)
- **Base de datos:** Supabase (PostgreSQL + RLS)
- **Hosting:** Netlify (frontend + funciones serverless)
- **WhatsApp:** Twilio Sandbox (puente hasta activar Meta API)
- **IA:** OpenAI gpt-4.1-mini (parse de texto a ítems de presupuesto)
- **PDF:** jsPDF + jspdf-autotable

---

## Estructura de archivos clave

```
src/
├── App.tsx                          ← Router principal (/, /admin, /g)
├── styles.css                       ← Estilos scoped bajo .pendientes
├── types/index.ts                   ← Interfaces TypeScript
├── lib/supabase.ts                  ← Cliente Supabase (anon key)
├── pages/
│   ├── Presupuesto.tsx              ← App original (sin tocar)
│   ├── Admin.tsx                    ← Panel Alexandra
│   └── Gustavo.tsx                  ← Vista móvil Gustavo
├── components/ItemForm.tsx          ← Formulario de ítems (presupuestador)
└── utils/
    ├── pdfGenerator.ts              ← Genera PDF con jsPDF
    └── calculationUtils.ts          ← Cálculos subtotal/IVA/total

netlify/functions/
├── notificar.js                     ← WhatsApp a Gustavo al crear pendiente
├── notificar-respuesta.js           ← WhatsApp a Alexandra cuando Gustavo responde
├── recordatorio.js                  ← Scheduled cada 2h: alerta pendientes vencidos
├── resumen-diario.js                ← Scheduled 9am: resumen del día a Gustavo
└── parse.js                         ← IA: convierte texto libre en ítems de presupuesto
```

---

## Base de datos — Tabla `pendientes`

```sql
CREATE TABLE pendientes (
  id                      uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at              timestamptz DEFAULT now() NOT NULL,
  cliente_nombre          text NOT NULL,
  tipo                    text NOT NULL CHECK (tipo IN ('confirmar_visita','revisar_fotos','presupuesto','otro')),
  descripcion             text,
  fecha_limite            timestamptz NOT NULL,
  fecha_trabajo           timestamptz,           -- agregado: fecha real del trabajo
  direccion               text,                  -- agregado: dirección de la visita
  drive_links             text[] DEFAULT '{}',
  estado                  text DEFAULT 'pendiente' CHECK (estado IN ('pendiente','recordatorio_enviado','respondido')),
  recordatorio_enviado_at timestamptz,
  respondido_at           timestamptz,
  respuesta               text,
  items                   jsonb DEFAULT '[]'      -- ítems de presupuesto generados por IA
);

-- RLS: permitir todo (sistema interno con token)
ALTER TABLE pendientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow all" ON pendientes FOR ALL USING (true) WITH CHECK (true);
```

---

## Variables de entorno

### `.env` local (E:/horma-presupuestos-v2/.env)

```env
# Supabase
VITE_SUPABASE_URL=https://[proyecto].supabase.co
VITE_SUPABASE_ANON_KEY=[anon key — Supabase > Settings > API]
SUPABASE_URL=https://[proyecto].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[service role key — Supabase > Settings > API]

# Auth
VITE_ADMIN_PASSWORD=horma2026
VITE_GUSTAVO_TOKEN=[token generado — mismo en GUSTAVO_TOKEN]
GUSTAVO_TOKEN=[token generado]

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=[Account SID — Twilio Console]
TWILIO_AUTH_TOKEN=[Auth Token — Twilio Console]
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
GUSTAVO_WHATSAPP=whatsapp:+56[número real de Gustavo]
ALEXANDRA_WHATSAPP=whatsapp:+56[número real de Alexandra]

# OpenAI
OPENAI_API_KEY=[sk-proj-... — platform.openai.com]
```

### En Netlify Dashboard (Environment Variables)
Deben estar todas las variables de arriba EXCEPTO las que empiezan con `VITE_` — esas solo van en el .env local para el build.

---

## Funciones scheduled (netlify.toml)

| Función | Schedule | Hora Chile | Qué hace |
|---|---|---|---|
| `recordatorio` | `0 */2 * * *` | Cada 2h | Alerta pendientes por vencer |
| `resumen-diario` | `0 12 * * *` | 9:00am | Resumen del día a Gustavo |

---

## Flujo completo del sistema

### Alexandra crea un pendiente
1. Entra a `/admin` con contraseña `horma2026`
2. Click "+ Nuevo pendiente"
3. Llena: cliente, tipo, descripción, fecha límite
4. Si es "Confirmar visita": también fecha del trabajo + dirección
5. Guarda → Supabase guarda el pendiente
6. Sistema envía WhatsApp a Gustavo automáticamente

### Gustavo responde
1. Recibe WhatsApp con link `/g?t=TOKEN`
2. Ve sus pendientes ordenados por urgencia
3. Escribe su respuesta en texto libre
4. Envía → sistema notifica a Alexandra por WhatsApp

### Para presupuestos (flujo IA)
1. Gustavo escribe texto libre: "tablero 80k, 3 circuitos 15k c/u..."
2. Alexandra recibe la respuesta en Admin
3. Click "✨ Generar ítems con IA" → OpenAI parsea el texto
4. Revisa la tabla de ítems generados
5. Click "📄 Generar PDF" → descarga el presupuesto

### Para visitas confirmadas
1. Alexandra crea visita con fecha_trabajo y dirección
2. Card muestra bloque amarillo 🔨 con fecha + dirección
3. Click "📅 Agendar en Calendar" → abre Google Calendar pre-llenado
4. Alexandra confirma el evento → Gustavo lo ve en Calendar con la dirección
5. Gustavo usa Calendar para rutas (Waze desde la dirección)

### Resumen diario (automático)
- Cada día a las 9am Gustavo recibe WhatsApp con:
  - Trabajos del día (con hora y dirección)
  - Pendientes sin responder

---

## Autenticación

| Quién | Método | Valor |
|---|---|---|
| Alexandra | Contraseña en localStorage | `horma2026` |
| Gustavo | Token en URL | `7f4e2b9d1a3c5e8f` |

El token de Gustavo va en la URL: `/g?t=7f4e2b9d1a3c5e8f`

---

## Pendiente importante antes de producción real

- [ ] Cambiar `GUSTAVO_WHATSAPP` al número real de Gustavo en Netlify
- [ ] Validar 2 días de prueba con número de Alexandra
- [ ] Confirmar que resumen-diario llega a las 9am

---

## Features implementados

- [x] Panel Admin con login, crear/editar/eliminar pendientes
- [x] Tabs Activos / Respondidos
- [x] Vista móvil Gustavo optimizada para iPhone
- [x] WhatsApp al crear pendiente (→ Gustavo)
- [x] WhatsApp al responder pendiente (→ Alexandra)
- [x] Recordatorio automático cada 2h si no responde
- [x] Resumen diario 9am (trabajos del día + pendientes)
- [x] IA para generar ítems de presupuesto desde texto libre
- [x] Generación de PDF desde Admin
- [x] Botón "Agendar en Calendar" con datos pre-llenados
- [x] Campo fecha_trabajo y dirección para visitas
- [x] Refresh silencioso en Admin (no interrumpe operaciones)
- [x] CSS scoped bajo .pendientes (no rompe el presupuestador)

---

## Repo

- **GitHub:** https://github.com/hormaelectricidadcl-cpu/horma-presupuestos
- **Branch principal:** main
- **Deploy:** automático en cada push a main vía Netlify
