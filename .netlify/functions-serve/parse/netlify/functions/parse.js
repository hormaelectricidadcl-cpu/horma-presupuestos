"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// netlify/functions/parse.js
var parse_exports = {};
__export(parse_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(parse_exports);
async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "M\xE9todo no permitido" })
      };
    }
    const { texto } = JSON.parse(event.body || "{}");
    if (!texto || !texto.trim()) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No hay texto para procesar" })
      };
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Falta OPENAI_API_KEY" })
      };
    }
    const prompt = `
Convierte el siguiente texto t\xE9cnico de presupuesto en un arreglo JSON v\xE1lido.

Reglas obligatorias:
- Responde solo con JSON v\xE1lido.
- No agregues explicaci\xF3n, t\xEDtulos ni markdown.
- Devuelve exclusivamente un arreglo JSON.
- Cada l\xEDnea representa un \xEDtem.
- Si una l\xEDnea comienza con un n\xFAmero, ese n\xFAmero es la cantidad.
- Si no aparece cantidad, usar 1.
- Si aparece "c/u", el valor indicado es precio unitario.
- Si no aparece "c/u", asumir que el valor es precio unitario del \xEDtem.
- El campo "precioUnitario" debe ser n\xFAmero sin puntos de miles.
- El campo "cantidad" debe ser n\xFAmero.
- Clasifica "categoria" \xFAnicamente como "MATERIALES" o "MANO DE OBRA".
- Usa "MATERIALES" para equipos, insumos o productos f\xEDsicos.
- Usa "MANO DE OBRA" para instalaci\xF3n, armado, configuraci\xF3n, reemplazo, montaje, canalizaci\xF3n, alambrado, revisi\xF3n o diagn\xF3stico.
- Mant\xE9n siglas t\xE9cnicas como NVR.
- Corrige ortograf\xEDa b\xE1sica en la descripci\xF3n.
- Formato exacto:

[
  {
    "categoria": "MATERIALES",
    "descripcion": "Texto",
    "cantidad": 1,
    "precioUnitario": 10000
  }
]

Texto:
${texto}
`;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
        temperature: 0
      })
    });
    const data = await response.json();
    if (!response.ok) {
      console.error("Error OpenAI:", data);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Error desde OpenAI",
          detalle: data
        })
      };
    }
    const textoRespuesta = data.output_text || data.output?.flatMap((item) => item.content || [])?.find((content) => content.type === "output_text" || typeof content.text === "string")?.text || "";
    if (!textoRespuesta || typeof textoRespuesta !== "string") {
      console.error("Respuesta OpenAI sin texto \xFAtil:", data);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "OpenAI no devolvi\xF3 texto utilizable",
          detalle: data
        })
      };
    }
    let textoLimpio = textoRespuesta.trim();
    const inicioArray = textoLimpio.indexOf("[");
    const finArray = textoLimpio.lastIndexOf("]");
    if (inicioArray !== -1 && finArray !== -1 && finArray > inicioArray) {
      textoLimpio = textoLimpio.substring(inicioArray, finArray + 1);
    }
    let items;
    try {
      items = JSON.parse(textoLimpio);
    } catch (e) {
      console.error("JSON inv\xE1lido devuelto por OpenAI:", textoRespuesta);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "La IA no devolvi\xF3 JSON v\xE1lido",
          bruto: textoRespuesta
        })
      };
    }
    if (!Array.isArray(items)) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "La IA no devolvi\xF3 un arreglo v\xE1lido",
          bruto: textoRespuesta
        })
      };
    }
    const itemsNormalizados = items.map((item) => ({
      categoria: String(item.categoria || "").toUpperCase() === "MANO DE OBRA" ? "MANO DE OBRA" : "MATERIALES",
      descripcion: String(item.descripcion || "").trim(),
      cantidad: Number(item.cantidad) > 0 ? Number(item.cantidad) : 1,
      precioUnitario: Number(item.precioUnitario) > 0 ? Number(item.precioUnitario) : 0
    }));
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: itemsNormalizados })
    };
  } catch (error) {
    console.error("ERROR parse.js:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: error.message || "Error interno en parse.js"
      })
    };
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});
//# sourceMappingURL=parse.js.map
