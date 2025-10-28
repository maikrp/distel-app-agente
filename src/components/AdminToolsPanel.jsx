/* eslint-disable no-unused-vars */
import { useState } from "react";
import { supabase } from "../supabaseClient";
import * as XLSX from "xlsx";

// ============================================================================
// ADMINISTRACIÓN DE PLATAFORMA — Panel Web (8 opciones)
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

  // Columnas que realmente existen en la tabla desabasto_registros
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

  // Renombres para formatos nuevos → nombres de tu tabla
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
    // fallback heurístico
    return cols.find(
      (c) =>
        c.includes("saldo") &&
        c.includes("promedio") &&
        (c.includes("diario") || c.includes("promedio_diario"))
    );
  };

  // Fecha/hora de Costa Rica (siempre -06)
  const ahoraCostaRica = () => {
    // Costa Rica no usa DST; aún así usamos la zona para formatear correctamente.
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

  // ==== Procesar Excel en memoria y cargar ====
  const manejarCarga = async () => {
    try {
      if (!archivo) {
        setMensaje("Debe seleccionar un archivo .xlsx primero.");
        return;
      }
      setLoading(true);
      setProgreso(0);
      setMensaje("📤 Procesando archivo...");

      // 1) Leer Excel (cabecera en fila 3 -> range: 2)
      const data = await archivo.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const hoja = workbook.SheetNames[0];

      const jsonOriginal = XLSX.utils.sheet_to_json(workbook.Sheets[hoja], {
        defval: null,
        range: 2,
      });

      // 2) Normalizar encabezados + aplicar renombres + eliminar "unnamed"
      const jsonNorm = jsonOriginal.map((row) => {
        const nuevo = {};
        for (const k of Object.keys(row)) {
          const nk = normalizeCol(k);
          if (!nk || nk.startsWith("unnamed")) continue;
          const destino = RENAME_MAP[nk] || nk;
          nuevo[destino] = row[k];
        }
        return nuevo;
      });

      if (jsonNorm.length === 0) {
        setMensaje("⚠️ El archivo no tiene filas de datos.");
        setLoading(false);
        return;
      }

      // 3) Filtro: excluir 'Normal' en saldo_menor_al_promedio_diario (o similar)
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
        setMensaje(
          "⚠️ No se encontró la columna de 'saldo menor al promedio diario'; se cargará todo."
        );
      }

      // 4) Agregar metadatos (hora Costa Rica fija -06) y limitar a columnas válidas
      const fechaCR = ahoraCostaRica();

      const procesados = filtrados.map((r) => {
        const soloPermitidos = {};
        for (const key of Object.keys(r)) {
          if (allowedColumns.includes(key)) {
            soloPermitidos[key] =
              r[key] === "" || r[key] === "NaN" || r[key] === "nan" ? null : r[key];
          }
        }
        soloPermitidos.fuente_archivo = archivo.name; // NOT NULL
        soloPermitidos.fecha_carga = fechaCR;          // NOT NULL
        return soloPermitidos;
      });

      setMensaje(
        `📊 ${jsonNorm.length} registros detectados — ${filtrados.length} válidos (${excluidos} excluidos por 'Normal').`
      );

      // 5) Insertar por lotes
      const lote = 500;
      let insertados = 0;
      for (let i = 0; i < procesados.length; i += lote) {
        const subset = procesados.slice(i, i + lote);
        if (subset.length === 0) continue;
        const { error } = await supabase.from("desabasto_registros").insert(subset);
        if (error) throw error;
        insertados += subset.length;
        setProgreso(Math.round((insertados / procesados.length) * 100));
      }

      setMensaje(`✅ ${insertados} registros insertados desde ${archivo.name} — ${fechaCR}`);
    } catch (e) {
      setMensaje(`❌ Error en carga: ${e.message}`);
    } finally {
      setLoading(false);
      setProgreso(0);
    }
  };

  // ==== MENÚ PRINCIPAL (8 OPCIONES) ====
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
          4️⃣ Borrar archivos .xlsx en Descargas
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
        <Button onClick={onVolver} className="bg-gray-700 hover:bg-gray-800 text-white mt-2">
          8️⃣ Salir / Volver al menú principal
        </Button>
      </div>
    </Card>
  );

  // ==== 1️⃣ Cargar archivo ====
  const cargarArchivoView = (
    <Card title="Cargar archivo (.xlsx)">
      <div className="space-y-4">
        <label className="block text-sm font-semibold text-gray-700 text-left">
          Seleccione archivo Excel:
        </label>
        <input
          type="file"
          accept=".xlsx"
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

        <Button onClick={manejarCarga} disabled={loading || !archivo} className="bg-blue-600 hover:bg-blue-700 text-white">
          {loading ? "Subiendo..." : "Subir archivo"}
        </Button>

        {progreso > 0 && (
          <p className="text-sm text-gray-700">⏳ Progreso: {progreso}% completado</p>
        )}

        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
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
          disabled={loading}
          className="bg-red-600 hover:bg-red-700 text-white"
        >
          {loading ? "Eliminando..." : "Borrar registros"}
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
          disabled={loading}
          className="bg-red-700 hover:bg-red-800 text-white"
        >
          {loading ? "Eliminando..." : "Borrar todos los registros"}
        </Button>
        <Button onClick={() => setVista("menu")} className="bg-gray-700 hover:bg-gray-800 text-white">
          ← Volver al menú
        </Button>
      </div>
    </Card>
  );

  // ==== 4️⃣ Borrar archivos locales (simulado) ====
  const borrarArchivosView = (
    <Card title="Borrar archivos .xlsx en Descargas">
      <div className="space-y-3">
        <p className="text-gray-700">
          Los navegadores no pueden eliminar archivos locales directamente. Esta acción simula la limpieza.
        </p>
        <Button
          onClick={() => setMensaje("🧹 Limpieza simulada de archivos .xlsx.")}
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
          Esta función genera reportes usando el script <b>admin_tools.py</b> en servidor/entorno local.
        </p>
        <Button onClick={() => setMensaje("⏳ Generando reportes...")} className="bg-green-600 hover:bg-green-700 text-white">
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

      {mensaje && (
        <p className="text-sm text-center text-gray-700 mt-4 max-w-md bg-gray-50 p-2 rounded-lg border border-gray-200 shadow-sm">
          {mensaje}
        </p>
      )}
    </div>
  );
}
