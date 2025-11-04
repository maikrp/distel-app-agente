/* eslint-disable no-unused-vars */
/* ============================================================================
   AdminToolsPanel.jsx — v1.0.9
   - 9 opciones. 100% navegador (móvil o PC).
   - Cambios desde v1.0.6:
     • Mantiene TODO el código base.
     • Carga Base y Carga Maestro ahora usan upsert con clave compuesta
       (id_cliente, tae) e ignoreDuplicates: true.
     • Acepta .xls y .xlsx.
   ============================================================================ */

import { useState } from "react";
import { supabase } from "../supabaseClient";
import * as XLSX from "xlsx";

// ============================================================================
// ADMINISTRACIÓN DE PLATAFORMA — Panel Web (9 opciones incluyendo Carga Maestro)
// ============================================================================

export default function AdminToolsPanel({ onVolver }) {
  // ==== Estados generales ====
  const [vista, setVista] = useState("menu");
  const [mensaje, setMensaje] = useState("");
  const [archivo, setArchivo] = useState(null);
  const [fechaBorrar, setFechaBorrar] = useState("");
  const [telefono, setTelefono] = useState("");
  const [nombre, setNombre] = useState("");
  const [acceso, setAcceso] = useState("regional");
  const [region, setRegion] = useState("");
  const [loading, setLoading] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [detalleProgreso, setDetalleProgreso] = useState("");

  // Columnas de la tabla desabasto_registros
  const allowedColumns = [
    "fuente_archivo",
    "fecha_carga",
    "mdn_usuario",
    "pdv",
    "saldo",
    "ultimo_uso_de_mis_recargas",
    "estado",
    "promadio_diario",
    "saldo_menor_al_promedio_diario",
    "promedio_semanal",
    "saldo_menor_al_promedio_semanal",
    "compro_saldo_hoy",
    "monto_comprado",
    "fecha_ultima_compra",
    "vendedor",
    "monto_recargado_este_mes",
    "promedio_recargado_en_los_ultimos_3_meses",
    "canal",
    "subcanal",
    "agrupacion",
    "nivel_socio",
    "jerarquias_n2_region",
    "jerarquias_n3_ruta",
    "id_socio",
    "region_comercial",
    "abastecimiento",
  ];

  // ==== UI helpers ====
  const Button = ({ children, onClick, className, disabled }) => (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full py-2 px-4 rounded-lg font-semibold transition-colors ${className} ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      {children}
    </button>
  );

  const Input = ({ placeholder, value, onChange, type = "text" }) => (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className="w-full border border-gray-300 rounded-lg p-2 text-gray-800 focus:ring-2 focus:ring-blue-500"
    />
  );

  const Card = ({ title, children }) => (
    <div className="bg-white rounded-3xl shadow-lg p-6 w-full max-w-md text-center">
      <h2 className="text-xl font-bold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  );

  // ==== Normalización de encabezados ====
  const normalizeCol = (col) =>
    String(col || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase();

  // Renombres para formatos nuevos → nombres de desabasto_registros
  const RENAME_MAP = {
    mdn: "mdn_usuario",
    saldo_menor_promedio_diario: "saldo_menor_al_promedio_diario",
    promedio_recaudo_diario: "promadio_diario",
    promedio_recaudo_semana: "promedio_semanal",
    recaudo_mes_actual: "monto_recargado_este_mes",
    promedio_recaudo_trimestral: "promedio_recargado_en_los_ultimos_3_meses",
    padre_vendedor: "vendedor",
    jerarquia_n2: "jerarquias_n2_region",
    jerarquia_n3: "jerarquias_n3_ruta",
    fecha_ultima_combra: "fecha_ultima_compra",
    ultimo_uso_mr: "ultimo_uso_de_mis_recargas",
  };

  // Detección robusta de columna "saldo_menor_al_promedio_diario"
  const pickColSaldoMenorPromedio = (cols) => {
    const candidatos = [
      "saldo_menor_al_promedio_diario",
      "saldo_menor_promedio_diario",
      "saldo_menor_promedio",
      "saldo_menor",
    ];
    for (const c of candidatos) if (cols.includes(c)) return c;
    return cols.find(
      (c) =>
        c.includes("saldo") &&
        c.includes("promedio") &&
        (c.includes("diario") || c.includes("promedio_diario"))
    );
  };

  // Fecha/hora de Costa Rica (siempre -06)
  const ahoraCostaRica = () => {
    const cr = new Date(
      new Date().toLocaleString("en-US", { timeZone: "America/Costa_Rica" })
    );
    const pad = (n) => String(n).padStart(2, "0");
    const yyyy = cr.getFullYear();
    const mm = pad(cr.getMonth() + 1);
    const dd = pad(cr.getDate());
    const hh = pad(cr.getHours());
    const mi = pad(cr.getMinutes());
    const ss = pad(cr.getSeconds());
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}-06`;
  };

  // Utilidad robusta: lee una hoja a JSON y además produce CSV para depuración
  const sheetToJsonRobusto = (sheet, opts = {}) => {
    const json = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false, ...opts });
    const csv = XLSX.utils.sheet_to_csv(sheet);
    return { json, csv };
  };

  // ===== Helpers deduplicación y conteos =====
  const getConteosClientes = async () => {
    const total = await supabase.from("clientes").select("id_cliente", { count: "exact" });
    const activos = await supabase
      .from("clientes")
      .select("id_cliente", { count: "exact" })
      .eq("estatus", "Activo");
    const inactivos = await supabase
      .from("clientes")
      .select("id_cliente", { count: "exact" })
      .eq("estatus", "Inactivo");
    return {
      total: total.count || 0,
      activos: activos.count || 0,
      inactivos: inactivos.count || 0,
    };
  };

  // Descarga todos los id_cliente existentes en páginas de 1000
  const fetchAllClienteIds = async () => {
    const pageSize = 1000;
    let from = 0;
    const ids = new Set();
    while (true) {
      const { data, error } = await supabase
        .from("clientes")
        .select("id_cliente")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const row of data) {
        if (row && row.id_cliente != null) ids.add(row.id_cliente);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return ids;
  };

  // Dedup dentro del arreglo por id_cliente, conservando el primero visto
  const dedupLocalPorId = (rows) => {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const key = r?.id_cliente ?? null;
      if (key == null) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  };

  // ==== Procesar Excel en memoria y cargar (Desabasto → desabasto_registros) ====
  const manejarCarga = async () => {
    try {
      if (!archivo) {
        setMensaje("Debe seleccionar un archivo .xls o .xlsx primero.");
        return;
      }
      setLoading(true);
      setProgreso(0);
      setDetalleProgreso("");
      setMensaje("📤 Procesando archivo...");

      const data = await archivo.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" }); // Detecta .xls/.xlsx
      const hoja = workbook.SheetNames[0];

      // En reportes de desabasto, la cabecera suele estar en fila 3 ⇒ range: 2
      const { json: jsonOriginal } = sheetToJsonRobusto(workbook.Sheets[hoja], { range: 2 });

      const jsonNorm = jsonOriginal.map((row) => {
        const nuevo = {};
        for (const k of Object.keys(row)) {
          const nk = normalizeCol(k);
          if (!nk || nk.startsWith("unnamed")) continue;
          const destino = RENAME_MAP[nk] || nk;
          const val = row[k];
          if (typeof val === "string") {
            const t = val.trim();
            nuevo[destino] = t === "" || t.toLowerCase() === "nan" ? null : t;
          } else {
            nuevo[destino] = val;
          }
        }
        return nuevo;
      });

      if (jsonNorm.length === 0) {
        setMensaje("⚠️ El archivo no tiene filas de datos.");
        setLoading(false);
        return;
      }

      const cols = Object.keys(jsonNorm[0]);
      const colSaldo = pickColSaldoMenorPromedio(cols);
      let filtrados = jsonNorm;
      let excluidos = 0;

      if (colSaldo) {
        filtrados = jsonNorm.filter(
          (r) => String(r[colSaldo] ?? "").trim().toLowerCase() !== "normal"
        );
        excluidos = jsonNorm.length - filtrados.length;
      } else {
        setMensaje("⚠️ No se encontró la columna de saldo menor al promedio diario.");
      }

      const fechaCR = ahoraCostaRica();
      const procesados = filtrados.map((r) => {
        const soloPermitidos = {};
        for (const key of Object.keys(r)) {
          if (allowedColumns.includes(key)) {
            soloPermitidos[key] =
              r[key] === "" || r[key] === "NaN" || r[key] === "nan" ? null : r[key];
          }
        }
        soloPermitidos.fuente_archivo = archivo.name;
        soloPermitidos.fecha_carga = fechaCR;
        return soloPermitidos;
      });

      const lote = 500;
      let insertados = 0;
      for (let i = 0; i < procesados.length; i += lote) {
        const subset = procesados.slice(i, i + lote);
        if (subset.length === 0) continue;
        const { error } = await supabase.from("desabasto_registros").insert(subset);
        if (error) throw error;
        insertados += subset.length;
        const pct = Math.round((insertados / procesados.length) * 100);
        setProgreso(pct);
        setDetalleProgreso(`${insertados}/${procesados.length}`);
      }

      setMensaje(`✅ ${insertados} registros insertados desde ${archivo.name} (excluidos ${excluidos} 'Normal')`);
    } catch (e) {
      setMensaje(`❌ Error en carga: ${e.message}`);
    } finally {
      setLoading(false);
      // no reiniciar a 0 para que el usuario vea el % final; lo limpiamos solo al cambiar de vista
    }
  };

  // ==== 1️⃣ Cargar archivo (Desabasto → desabasto_registros) ====
  const cargarArchivoView = (
    <Card title="Cargar archivo (.xls/.xlsx)">
      <div className="space-y-4">
        <label className="block text-sm font-semibold text-gray-700 text-left">
          Seleccione archivo Excel:
        </label>
        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setArchivo(file);
            if (file) setMensaje(`📁 Archivo seleccionado: ${file.name}`);
            else setMensaje("");
          }}
          className="w-full border border-gray-300 rounded-lg p-2 bg-white text-gray-700 cursor-pointer"
        />
        {archivo && (
          <p className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-2">
            ✅ <b>{archivo.name}</b> listo para subir
          </p>
        )}
        <Button
          onClick={manejarCarga}
          disabled={loading || !archivo}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {loading ? "Subiendo..." : "Subir archivo"}
        </Button>
        {progreso > 0 && (
          <p className="text-sm text-gray-700">⏳ Progreso: {progreso}% {detalleProgreso && `(${detalleProgreso})`}</p>
        )}
        <Button
          onClick={() => {
            setVista("menu");
            setProgreso(0);
            setDetalleProgreso("");
          }}
          className="bg-gray-700 hover:bg-gray-800 text-white"
        >
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 2️⃣ Borrar registros por fecha ====
  const borrarFechaView = (
    <Card title="Borrar registros por fecha">
      <div className="space-y-3">
        <Input type="date" value={fechaBorrar} onChange={(e) => setFechaBorrar(e.target.value)} />
        <Button
          onClick={async () => {
            try {
              if (!fechaBorrar) {
                setMensaje("Debe ingresar una fecha (YYYY-MM-DD).");
                return;
              }
              const desde = `${fechaBorrar} 00:00:00`;
              const hasta = `${fechaBorrar} 23:59:59`;
              const { error } = await supabase
                .from("desabasto_registros")
                .delete()
                .gte("fecha_carga", desde)
                .lte("fecha_carga", hasta);
              if (error) throw error;
              setMensaje(`✅ Registros del ${fechaBorrar} eliminados.`);
            } catch (e) {
              setMensaje(`❌ Error: ${e.message}`);
            }
          }}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          Borrar registros
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 3️⃣ Borrar todos los registros ====
  const borrarTodoView = (
    <Card title="Borrar todos los registros">
      <div className="space-y-3">
        <p className="text-gray-700">
          Esta acción eliminará <b>todos</b> los registros de la base de datos. Proceda con precaución.
        </p>
        <Button
          onClick={async () => {
            try {
              if (!window.confirm("¿Seguro que desea eliminar todos los registros?")) return;
              const { error } = await supabase.from("desabasto_registros").delete().neq("id", 0);
              if (error) throw error;
              setMensaje("✅ Todos los registros fueron eliminados.");
            } catch (e) {
              setMensaje(`❌ Error: ${e.message}`);
            }
          }}
          className="bg-red-700 hover:bg-red-800 text-white"
        >
          Borrar todos los registros
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );
  // ==== 4️⃣ Borrar archivos locales (simulado) ====
  const borrarArchivosView = (
    <Card title="Borrar archivos .xlsx/.xls en Descargas">
      <div className="space-y-3">
        <p className="text-gray-700">
          Los navegadores no pueden eliminar archivos locales directamente. Esta acción simula la limpieza.
        </p>
        <Button
          onClick={() => setMensaje("🧹 Limpieza simulada de archivos .xlsx/.xls.")}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          Ejecutar limpieza
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 5️⃣ Generar reportes (placeholder) ====
  const generarReportesView = (
    <Card title="Generar reportes de desabasto por ruta">
      <div className="space-y-3">
        <p className="text-gray-700">
          Esta función genera reportes usando lógica de servidor. Próximamente versión 100% web.
        </p>
        <Button
          onClick={() => setMensaje("⏳ Generando reportes...")}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          Generar reportes
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 6️⃣ Crear supervisor ====
  const crearSupervisorView = (
    <Card title="Crear supervisor (clave cifrada)">
      <div className="space-y-3">
        <Input placeholder="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        <Input placeholder="Nombre completo" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <select
          value={acceso}
          onChange={(e) => setAcceso(e.target.value)}
          className="w-full border rounded-lg p-2 text-gray-800"
        >
          <option value="regional">Regional</option>
          <option value="global">Global</option>
        </select>
        {acceso === "regional" && (
          <Input placeholder="Región" value={region} onChange={(e) => setRegion(e.target.value)} />
        )}
        <Button
          onClick={async () => {
            try {
              if (!telefono || !nombre) {
                setMensaje("Debe ingresar teléfono y nombre.");
                return;
              }
              const claveTemporal = "1234";
              const { error } = await supabase.from("agentes").insert([
                {
                  telefono,
                  nombre,
                  vendedor_raw: nombre,
                  region: acceso === "global" ? null : region || null,
                  supervisor: "supervisor",
                  activo: true,
                  tipo: "supervisor",
                  acceso,
                  clave_temporal: true,
                },
              ]);
              if (error) throw error;
              setMensaje(`✅ Supervisor creado (${acceso}) con clave temporal '${claveTemporal}'.`);
            } catch (e) {
              setMensaje(`❌ Error: ${e.message}`);
            }
          }}
          className="bg-blue-500 hover:bg-blue-600 text-white"
        >
          Crear supervisor
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 7️⃣ Resetear clave ====
  const resetClaveView = (
    <Card title="Resetear clave de usuario">
      <div className="space-y-3">
        <Input placeholder="Teléfono del usuario" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        <Button
          onClick={async () => {
            try {
              if (!telefono) {
                setMensaje("Debe ingresar un número válido.");
                return;
              }
              const { data, error } = await supabase
                .from("agentes")
                .update({ clave_temporal: true })
                .eq("telefono", telefono)
                .select();
              if (error) throw error;
              if (!data || data.length === 0) setMensaje("⚠️ Usuario no encontrado.");
              else setMensaje("✅ Clave restablecida a '1234'.");
            } catch (e) {
              setMensaje(`❌ Error: ${e.message}`);
            }
          }}
          className="bg-yellow-500 hover:bg-yellow-600 text-white"
        >
          Resetear clave
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 8️⃣ Carga Base de Clientes (Desabasto) — 100% web, .xls/.xlsx, sin duplicados ====
  const cargaClientesView = (
    <Card title="Carga de Base de Clientes — Desabasto (Web)">
      <div className="space-y-4">
        <p className="text-gray-700">
          Procesa un Excel de clientes en el navegador (.xls o .xlsx), normaliza columnas y agrega solo IDs nuevos a <b>clientes</b>.
        </p>

        <Button
          onClick={async () => {
            setMensaje("⏳ Consultando registros actuales...");
            try {
              const c = await getConteosClientes();
              setMensaje(`📊 Conteo inicial — Total: ${c.total} | Activos: ${c.activos} | Inactivos: ${c.inactivos}`);
            } catch (err) {
              setMensaje(`❌ Error al consultar: ${err.message}`);
            }
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          🔍 Mostrar conteo inicial
        </Button>

        <label className="block text-sm font-semibold text-gray-700 text-left">
          Seleccione archivo Excel:
        </label>
        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setArchivo(file);
            if (file) setMensaje(`📁 Archivo seleccionado: ${file.name}`);
            else setMensaje("");
          }}
          className="w-full border border-gray-300 rounded-lg p-2 bg-white text-gray-700 cursor-pointer"
        />

        {archivo && (
          <p className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-2">
            ✅ <b>{archivo.name}</b> listo para procesar
          </p>
        )}

        <Button
          onClick={async () => {
            try {
              if (!archivo) {
                setMensaje("Debe seleccionar un archivo .xls o .xlsx primero.");
                return;
              }
              setLoading(true);
              setProgreso(0);
              setDetalleProgreso("");
              setMensaje("📤 Procesando base de clientes (upsert id_cliente+tae, sin duplicados)...");

              // 1) Leer Excel
              const data = await archivo.arrayBuffer();
              const workbook = XLSX.read(data, { type: "array" }); // .xls/.xlsx
              const hoja = workbook.SheetNames[0];
              const { json } = sheetToJsonRobusto(workbook.Sheets[hoja], { defval: null });

              // 2) Mapeo Excel → tabla clientes
              const mapa = {
                "ID Cliente": "id_cliente",
                "Codigo Tercero Recarga (TAE)": "tae",
                "ID Ruta": "id_ruta",
                "Nombre Ruta": "nombre_ruta",
                "ID Sede": "id_sede",
                "Nombre Sede": "nombre_sede",
                "Tipo Cliente": "tipo_cliente",
                "Nombre del Punto de venta": "pdv",
                "Dirección": "direccion",
                "Provincia": "provincia",
                "Cantón": "canton",
                "Distrito": "distrito",
                "Contacto o Propietario del PDV": "contacto",
                "Cédula Física o Jurídica": "cedula",
                "Teléfono": "telefono",
                "Dirección Electrónica": "correo",
                "Frecuencia de Visita": "visita",
                "Georeferenciación": "geo",
                "Lunes": "lunes",
                "Martes": "martes",
                "Miércoles": "miercoles",
                "Jueves": "jueves",
                "Viernes": "viernes",
                "Sábado": "sabado",
                "Domingo": "domingo",
                "Fecha Ingreso": "fecha_ingreso",
                "Monto Crédito": "credito",
                "Días Crédito": "dias",
                "ID Tipo Punto": "id_punto",
                "Nombre Tipo Punto": "tipo_punto",
                "Barrio": "barrio",
                "Fecha Cumpleaños": "cumpleanos",
                "ID_RDT": "id_rdt",
                "Activo/Inactivo": "estatus",
              };

              // 3) Normalización y limpieza base
              const datos = json.map((r) => {
                const limpio = {};
                for (const [k, v] of Object.entries(r)) {
                  const destino = mapa[k] || null;
                  if (!destino) continue;
                  if (typeof v === "string") {
                    const t = v.trim();
                    limpio[destino] = t === "" || t.toLowerCase() === "nan" ? null : t;
                  } else {
                    limpio[destino] = v;
                  }
                }
                return limpio;
              });

              // Días "X" → 1 o null
              const dias = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
              for (const d of dias) {
                for (const row of datos) {
                  if (d in row) {
                    const val = row[d];
                    if (typeof val === "string" && val.trim().toUpperCase() === "X") {
                      row[d] = 1;
                    } else if (typeof val === "string" && /^\d+$/.test(val.trim())) {
                      row[d] = parseInt(val.trim(), 10);
                    } else if (val === "" || val === null) {
                      row[d] = null;
                    }
                  }
                }
              }

              // Fechas a YYYY-MM-DD
              const parseFecha = (x) => {
                if (!x) return null;
                const dt = new Date(x);
                if (isNaN(dt.getTime())) return null;
                const yyyy = dt.getFullYear();
                const mm = String(dt.getMonth() + 1).padStart(2, "0");
                const dd = String(dt.getDate()).padStart(2, "0");
                return `${yyyy}-${mm}-${dd}`;
              };
              for (const row of datos) {
                if ("fecha_ingreso" in row) row["fecha_ingreso"] = parseFecha(row["fecha_ingreso"]);
                if ("cumpleanos" in row) row["cumpleanos"] = parseFecha(row["cumpleanos"]);
              }

              // 4) Filtro local por id_cliente (elimina duplicados dentro del Excel)
              const datosConId = datos.filter((r) => r.id_cliente != null);
              const dedupLocal = dedupLocalPorId(datosConId);

              // 5) Insertar/actualizar por clave compuesta (id_cliente, tae)
              //    Solo subimos en lotes; el onConflict evita duplicados.
              let procesados = 0;
              const lote = 500;
              for (let i = 0; i < dedupLocal.length; i += lote) {
                const subset = dedupLocal.slice(i, i + lote);
                const { error } = await supabase
                  .from("clientes")
                  .upsert(subset, { onConflict: ["id_cliente", "tae"], ignoreDuplicates: true });
                if (error) throw error;
                procesados += subset.length;
                const pct = Math.round((procesados / dedupLocal.length) * 100);
                setProgreso(pct);
                setDetalleProgreso(`${procesados}/${dedupLocal.length}`);
              }

              // 6) Conteo final
              const c = await getConteosClientes();
              setMensaje(
                `✅ Carga base completada por upsert. Total: ${c.total} | Activos: ${c.activos} | Inactivos: ${c.inactivos}`
              );
            } catch (err) {
              setMensaje(`❌ Error en carga: ${err.message}`);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || !archivo}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          {loading ? "Subiendo..." : "Subir Base Desabasto"}
        </Button>

        {progreso > 0 && (
          <p className="text-sm text-gray-700">⏳ Progreso: {progreso}% {detalleProgreso && `(${detalleProgreso})`}</p>
        )}

        <Button
          onClick={() => {
            setVista("menu");
            setProgreso(0);
            setDetalleProgreso("");
          }}
          className="bg-gray-700 hover:bg-gray-800 text-white"
        >
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );
  // ==== 9️⃣ 🧾 Carga Maestro (Clientes) — .xls/.xlsx, upsert id_cliente+tae ====
  const cargaMaestroView = (
    <Card title="Carga Maestro (Clientes)">
      <div className="space-y-4">
        <p className="text-gray-700">
          Procesa el maestro de clientes (.xls/.xlsx), limpia columnas y realiza <b>upsert por (id_cliente, tae)</b> en <b>clientes</b>.
        </p>

        <Button
          onClick={async () => {
            setMensaje("⏳ Consultando registros actuales...");
            try {
              const c = await getConteosClientes();
              setMensaje(`📊 Conteo inicial — Total: ${c.total} | Activos: ${c.activos} | Inactivos: ${c.inactivos}`);
            } catch (err) {
              setMensaje(`❌ Error al consultar: ${err.message}`);
            }
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          🔍 Mostrar conteo inicial
        </Button>

        <label className="block text-sm font-semibold text-gray-700 text-left">
          Seleccione archivo Excel:
        </label>
        <input
          type="file"
          accept=".xlsx, .xls"
          onChange={(e) => {
            const file = e.target.files?.[0] || null;
            setArchivo(file);
            if (file) setMensaje(`📁 Archivo seleccionado: ${file.name}`);
            else setMensaje("");
          }}
          className="w-full border border-gray-300 rounded-lg p-2 bg-white text-gray-700 cursor-pointer"
        />

        {archivo && (
          <p className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg p-2">
            ✅ <b>{archivo.name}</b> listo para procesar
          </p>
        )}

        <Button
          onClick={async () => {
            try {
              if (!archivo) {
                setMensaje("Debe seleccionar un archivo .xls o .xlsx primero.");
                return;
              }
              setLoading(true);
              setProgreso(0);
              setDetalleProgreso("");
              setMensaje("📤 Procesando archivo maestro (upsert id_cliente+tae)...");

              // 1) Leer Excel
              const data = await archivo.arrayBuffer();
              const workbook = XLSX.read(data, { type: "array" }); // .xls/.xlsx
              const hoja = workbook.SheetNames[0];
              const { json } = sheetToJsonRobusto(workbook.Sheets[hoja], { defval: null });

              // 2) Mapeo Excel → tabla clientes
              const mapa = {
                "ID Cliente": "id_cliente",
                "Codigo Tercero Recarga (TAE)": "tae",
                "ID Ruta": "id_ruta",
                "Nombre Ruta": "nombre_ruta",
                "ID Sede": "id_sede",
                "Nombre Sede": "nombre_sede",
                "Tipo Cliente": "tipo_cliente",
                "Nombre del Punto de venta": "pdv",
                "Dirección": "direccion",
                "Provincia": "provincia",
                "Cantón": "canton",
                "Distrito": "distrito",
                "Contacto o Propietario del PDV": "contacto",
                "Cédula Física o Jurídica": "cedula",
                "Teléfono": "telefono",
                "Dirección Electrónica": "correo",
                "Frecuencia de Visita": "visita",
                "Georeferenciación": "geo",
                "Lunes": "lunes",
                "Martes": "martes",
                "Miércoles": "miercoles",
                "Jueves": "jueves",
                "Viernes": "viernes",
                "Sábado": "sabado",
                "Domingo": "domingo",
                "Fecha Ingreso": "fecha_ingreso",
                "Monto Crédito": "credito",
                "Días Crédito": "dias",
                "ID Tipo Punto": "id_punto",
                "Nombre Tipo Punto": "tipo_punto",
                "Barrio": "barrio",
                "Fecha Cumpleaños": "cumpleanos",
                "ID_RDT": "id_rdt",
                "Activo/Inactivo": "estatus",
              };

              // 3) Normalización y limpieza base
              const datos = json.map((r) => {
                const limpio = {};
                for (const [k, v] of Object.entries(r)) {
                  const destino = mapa[k] || null;
                  if (!destino) continue;
                  if (typeof v === "string") {
                    const t = v.trim();
                    limpio[destino] = t === "" || t.toLowerCase() === "nan" ? null : t;
                  } else {
                    limpio[destino] = v;
                  }
                }
                return limpio;
              });

              // Días "X" → 1 o null
              const dias = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"];
              for (const d of dias) {
                for (const row of datos) {
                  if (d in row) {
                    const val = row[d];
                    if (typeof val === "string" && val.trim().toUpperCase() === "X") {
                      row[d] = 1;
                    } else if (typeof val === "string" && /^\d+$/.test(val.trim())) {
                      row[d] = parseInt(val.trim(), 10);
                    } else if (val === "" || val === null) {
                      row[d] = null;
                    }
                  }
                }
              }

              // Fechas a YYYY-MM-DD
              const parseFecha = (x) => {
                if (!x) return null;
                const dt = new Date(x);
                if (isNaN(dt.getTime())) return null;
                const yyyy = dt.getFullYear();
                const mm = String(dt.getMonth() + 1).padStart(2, "0");
                const dd = String(dt.getDate()).padStart(2, "0");
                return `${yyyy}-${mm}-${dd}`;
              };
              for (const row of datos) {
                if ("fecha_ingreso" in row) row["fecha_ingreso"] = parseFecha(row["fecha_ingreso"]);
                if ("cumpleanos" in row) row["cumpleanos"] = parseFecha(row["cumpleanos"]);
              }

              // 4) Filtro local por id_cliente (elimina duplicados dentro del Excel)
              const datosConId = datos.filter((r) => r.id_cliente != null);
              const dedupLocal = dedupLocalPorId(datosConId);

              // 5) Upsert en lotes por clave compuesta (id_cliente, tae)
              let procesados = 0;
              const lote = 500;
              for (let i = 0; i < dedupLocal.length; i += lote) {
                const subset = dedupLocal.slice(i, i + lote);
                const { error } = await supabase
                  .from("clientes")
                  .upsert(subset, { onConflict: ["id_cliente", "tae"], ignoreDuplicates: true });
                if (error) throw error;
                procesados += subset.length;
                const pct = Math.round((procesados / dedupLocal.length) * 100);
                setProgreso(pct);
                setDetalleProgreso(`${procesados}/${dedupLocal.length}`);
              }

              // 6) Conteo final
              const c = await getConteosClientes();
              setMensaje(
                `✅ Carga maestro completada por upsert. Total: ${c.total} | Activos: ${c.activos} | Inactivos: ${c.inactivos}`
              );
            } catch (err) {
              setMensaje(`❌ Error en carga: ${err.message}`);
            } finally {
              setLoading(false);
            }
          }}
          disabled={loading || !archivo}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          {loading ? "Subiendo..." : "Subir Maestro"}
        </Button>

        {progreso > 0 && (
          <p className="text-sm text-gray-700">⏳ Progreso: {progreso}% {detalleProgreso && `(${detalleProgreso})`}</p>
        )}

        <Button
          onClick={() => {
            setVista("menu");
            setProgreso(0);
            setDetalleProgreso("");
          }}
          className="bg-gray-700 hover:bg-gray-800 text-white"
        >
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== MENÚ PRINCIPAL (9 opciones) ====
  const menuPrincipal = (
    <Card title="Administración de Plataforma">
      <div className="space-y-3">
        <Button onClick={() => setVista("cargarArchivo")} className="bg-blue-600 hover:bg-blue-700 text-white">
          1️⃣ Cargar archivo
        </Button>
        <Button onClick={() => setVista("borrarFecha")} className="bg-red-600 hover:bg-red-700 text-white">
          2️⃣ Borrar registros de una fecha
        </Button>
        <Button onClick={() => setVista("borrarTodo")} className="bg-red-700 hover:bg-red-800 text-white">
          3️⃣ Borrar todos los registros
        </Button>
        <Button onClick={() => setVista("borrarArchivos")} className="bg-orange-500 hover:bg-orange-600 text-white">
          4️⃣ Borrar archivos .xlsx/.xls en Descargas
        </Button>
        <Button onClick={() => setVista("generarReportes")} className="bg-green-600 hover:bg-green-700 text-white">
          5️⃣ Generar reportes de desabasto por ruta
        </Button>
        <Button onClick={() => setVista("crearSupervisor")} className="bg-blue-500 hover:bg-blue-600 text-white">
          6️⃣ Crear supervisor (clave cifrada)
        </Button>
        <Button onClick={() => setVista("resetClave")} className="bg-yellow-500 hover:bg-yellow-600 text-white">
          7️⃣ Resetear clave de usuario
        </Button>
        <Button
          onClick={() => setVista("cargaClientes")}
          className="bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          8️⃣ 🧩 Carga Base de Clientes (Desabasto)
        </Button>
        <Button
          onClick={() => setVista("cargaMaestro")}
          className="bg-teal-600 hover:bg-teal-700 text-white"
        >
          9️⃣ 🧾 Carga Maestro (Clientes)
        </Button>
        <Button onClick={onVolver} className="bg-gray-700 hover:bg-gray-800 text-white mt-2">
          🔙 Salir / Volver al menú principal
        </Button>
      </div>
    </Card>
  );

  // ==== Render principal ====
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-6 overflow-y-auto">
      {vista === "menu" && menuPrincipal}
      {vista === "cargarArchivo" && cargarArchivoView}
      {vista === "borrarFecha" && borrarFechaView}
      {vista === "borrarTodo" && borrarTodoView}
      {vista === "borrarArchivos" && borrarArchivosView}
      {vista === "generarReportes" && generarReportesView}
      {vista === "crearSupervisor" && crearSupervisorView}
      {vista === "resetClave" && resetClaveView}
      {vista === "cargaClientes" && cargaClientesView}
      {vista === "cargaMaestro" && cargaMaestroView}

      {mensaje && (
        <p className="text-sm text-center text-gray-700 mt-4 max-w-md bg-gray-50 p-2 rounded-lg border border-gray-200 shadow-sm">
          {mensaje}
        </p>
      )}
    </div>
  );
}
