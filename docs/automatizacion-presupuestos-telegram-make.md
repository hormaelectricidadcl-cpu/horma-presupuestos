# Automatización de Presupuestos: Telegram → Make.com → PDF → Cliente

## ¿Qué hace este sistema?

El técnico escribe un mensaje de texto en Telegram con los ítems del trabajo.  
El sistema lo clasifica, calcula, genera el PDF y se lo manda al cliente **solo.**  
Sin abrir el computador. Sin copiar y pegar. Sin errores de cálculo.

---

## Flujo completo

```
Técnico escribe en Telegram
         ↓
    Make.com recibe
         ↓
POST /api/parse-etapas
(IA clasifica ítems en fases y calcula totales)
         ↓
POST /api/generar-pdf
(servidor genera el PDF con diseño profesional)
         ↓
         ├──→ HubSpot: crea Contacto + Negocio con el total
         ├──→ Gmail: envía PDF al cliente
         └──→ Telegram: notifica al técnico "Enviado. Total $X"
```

---

## Formato del mensaje de Telegram

El técnico debe respetar este formato mínimo:

```
CLIENTE: Patricio Valdés
TEL: +56 9 8765 4321
EMAIL: patricio@gmail.com
DIRECCIÓN: Las Condes, Santiago
GG: 10

Mano de obra:
75 Reemplazo de cable centros eléctricos 13.000
2 Instalación de tablero de distribución 45.000

Materiales:
50 ml Cable 2.5mm 800
1 Tablero con accesorios 120.000
```

> `GG` es el porcentaje de Gastos Generales (0 si no aplica).

---

## Stack tecnológico

| Componente | Tecnología | Costo |
|---|---|---|
| Frontend / Presupuestador | React + Cloudflare Pages | Gratis |
| IA clasificación de ítems | OpenAI GPT-4.1-mini | ~$0.01 por presupuesto |
| Generación PDF servidor | Cloudflare Worker + pdf-lib | Gratis |
| Automatización | Make.com (plan Core) | ~$10/mes |
| CRM | HubSpot (plan gratuito) | Gratis |
| Email al cliente | Gmail via Make.com | Gratis |
| Bot mensajería | Telegram Bot API | Gratis |
| Base de datos / Auth | Supabase (plan gratuito) | Gratis |

**Costo total operación: ~$10/mes**

---

## Lo que está construido hoy (Mayo 2026)

- [x] Presupuestador web con login (3 usuarios)
- [x] IA clasifica texto plano en 4 fases eléctricas
- [x] PDF profesional con logo, fases, MO/MAT, GG, IVA, TOTAL
- [x] Endpoint `/api/parse-etapas` — acepta texto plano
- [x] Endpoint `/api/parse-json` — acepta JSON estructurado (Make.com ready)
- [x] Historial de presupuestos guardado en Supabase
- [x] Autenticación segura (Supabase Auth, sin registro público)

## Lo que falta para el flujo 100% automático

- [ ] Endpoint `/api/generar-pdf` — genera PDF en el servidor (sin browser)
- [ ] Bot de Telegram configurado en BotFather
- [ ] Flujo Make.com armado (Telegram → parse → PDF → HubSpot → Gmail)
- [ ] Template de email al cliente

---

## Endpoint pendiente: `/api/generar-pdf`

### Input (JSON)
```json
{
  "cliente": {
    "nombre": "Patricio Valdés",
    "telefono": "+56 9 8765 4321",
    "email": "patricio@gmail.com",
    "direccion": "Las Condes, Santiago"
  },
  "etapas": [ ... ],
  "gg_pct": 10,
  "gg_amount": 185000
}
```

### Output
Archivo `.pdf` en base64 o binary — Make.com lo toma y adjunta al email.

### Implementación
Cloudflare Worker usando `pdf-lib` (corre server-side, sin browser).  
Replica el diseño exacto del PDF actual: 7 columnas, fases, colores Horma, logo.

**Tiempo estimado de desarrollo: 2-3 horas.**

---

## Propuesta de valor para otros técnicos

Este sistema resuelve el problema más común del técnico independiente:

> *"Pierdo tiempo armando presupuestos a mano, me equivoco en los cálculos y el cliente tarda en recibir la cotización."*

### Lo que obtiene el técnico

- Presupuesto listo en **menos de 2 minutos** desde el celular
- PDF con imagen profesional (logo, fases, desglose MO/Material)
- Cliente recibe el correo **automáticamente** con el PDF adjunto
- Historial de todos los presupuestos en una base de datos
- Contactos y negocios creados en HubSpot sin tocar el CRM

### Modelo de negocio sugerido

| Plan | Precio | Incluye |
|---|---|---|
| Básico | $15.000/mes | Presupuestador web + historial |
| Pro | $35.000/mes | Todo lo anterior + Telegram + PDF automático |
| Pro + CRM | $50.000/mes | Todo lo anterior + HubSpot + email al cliente |

> Costos de infraestructura (~$10/mes) cubiertos en cualquier plan.

---

## Notas técnicas para replicar en otro cliente

1. Fork del repositorio `horma-presupuestos`
2. Cambiar logo, colores y nombre en `pdfGeneratorEtapas.ts`
3. Crear proyecto en Cloudflare Pages + Supabase nuevos
4. Configurar variables de entorno (OpenAI key, Supabase keys)
5. Ejecutar `/api/setup-usuarios` para crear los usuarios del cliente
6. Ejecutar SQL de tabla `presupuestos` en el nuevo Supabase
7. Conectar Make.com con los endpoints del nuevo dominio

**Tiempo de onboarding de un cliente nuevo: ~2 horas.**

---

*Sistema diseñado para el rubro eléctrico chileno. Adaptable a gasfitería, climatización, construcción liviana.*
