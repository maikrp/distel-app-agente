/* eslint-disable no-unused-vars */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export default function GlobalSupervisorMenu({ usuario }) {
  // Vistas: menu | actual | anterior | historico | region | agente | historicoRegionAgentes
  const [vista, setVista] = useState("menu");

  // Contexto de fecha: 0=hoy, 1=ayer (CR).
  const [offsetDiasCtx, setOffsetDiasCtx] = useState(0);

  // Estados globales
  const [regiones, setRegiones] = useState([]);
  const [regionSeleccionada, setRegionSeleccionada] = useState(null);
  const [agentesRegion, setAgentesRegion] = useState([]);
  const [agenteSeleccionado, setAgenteSeleccionado] = useState(null);
  const [detallesAgente, setDetallesAgente] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resumenGlobal, setResumenGlobal] = useState({});

  // Histórico global (por región)
  const [historico, setHistorico] = useState([]);
  const [fechaRango, setFechaRango] = useState({ inicio: null, fin: null });

  // Histórico por agentes de una región
  const [historicoRegionAgentes, setHistoricoRegionAgentes] = useState([]);
  const [fechaRangoRegion, setFechaRangoRegion] = useState({ inicio: null, fin: null });

  // ==== Zona horaria y helpers de fecha ====
  const TZ = "America/Costa_Rica";

  const hoyISO = () => {
    const nowCR = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    const y = nowCR.getFullYear();
    const m = String(nowCR.getMonth() + 1).padStart(2, "0");
    const d = String(nowCR.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const isoNDiasAtras = (n) => {
    const nowCR = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
    const d = new Date(nowCR.getFullYear(), nowCR.getMonth(), nowCR.getDate() - n);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  };

  const parseISOasCRDate = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split("-").map(Number);
    // Fija mediodía UTC para evitar saltos por TZ
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  };

  const formatFechaCortoCR = (iso) =>
    parseISOasCRDate(iso)?.toLocaleDateString("es-CR", {
      timeZone: TZ,
      day: "2-digit",
      month: "short",
    }) || "";

  const formatFechaLargoCR = (iso) =>
    parseISOasCRDate(iso)?.toLocaleDateString("es-CR", {
      timeZone: TZ,
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) || "";

  // Solo fecha dd/mm/yyyy
  const formatSoloFechaCR = (iso) =>
    parseISOasCRDate(iso)?.toLocaleDateString("es-CR", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }) || "";

  // ==== Formateo números ====
  const formatCRC = (val) => {
    const n = Number(val ?? 0);
    // Requiere coma para miles y 2 decimales: 17,520.00
    return `₡${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // ==== Semáforo ====
  const obtenerSemaforo = (p) => {
    if (p === 100) return "🟢";
    if (p >= 80) return "🟡";
    if (p >= 50) return "🟠";
    return "🔴";
  };

  // ==== Normalización de región ====
  const normalizarRegion = (r) => {
    const n = (r || "").trim().toLowerCase();
    if (!n) return null;
    if (n.includes("oficina")) return null;
    if (n === "gte" || n === "gte altura" || n === "gte bajura") return "GTE";
    if (n.includes("zona norte") || n === "norte") return "NORTE";
    if (n === "gam") return "GAM";
    return (r || "").toUpperCase();
  };

  // ===================== CARGAS =====================

  // Resumen global por fecha (hoy o ayer) con Avance y Efectividad
  const cargarResumenGlobalGenerico = useCallback(async (offsetDias = 0) => {
    setLoading(true);
    const fecha = isoNDiasAtras(offsetDias);
    try {
      const { data: agentesDataRaw, error: agentesError } = await supabase
        .from("agentes")
        .select("*")
        .ilike("tipo", "%agente%")
        .eq("activo", true);
      if (agentesError) throw agentesError;

      const agentesData = (agentesDataRaw || [])
        .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
        .filter((a) => a.region_norm && a.ruta_excel);

      const regionesMap = {};
      agentesData.forEach((a) => {
        if (!regionesMap[a.region_norm]) regionesMap[a.region_norm] = [];
        regionesMap[a.region_norm].push(a);
      });

      let totalGlobalDesabasto = 0;
      let totalGlobalAtendidos = 0;
      let totalGlobalEfectivos = 0;

      const regionesConDatos = await Promise.all(
        Object.keys(regionesMap).map(async (regionKey) => {
          const agentesRegionLocal = regionesMap[regionKey];
          let totalRegionDesabasto = 0;
          let totalRegionAtendidos = 0;
          let totalRegionEfectivos = 0;

          await Promise.all(
            agentesRegionLocal.map(async (agente) => {
              const { data: registros } = await supabase
                .from("vw_desabasto_unicos")
                .select(
                  "mdn_usuario, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta"
                )
                .ilike("jerarquias_n3_ruta", `%${agente.ruta_excel}%`)
                .in("saldo_menor_al_promedio_diario", [
                  "Menor al 25%",
                  "Menor al 50%",
                  "Menor al 75%",
                ])
                .gte("fecha_carga", `${fecha}T00:00:00`)
                .lte("fecha_carga", `${fecha}T23:59:59`);

              const { data: atenciones } = await supabase
                .from("atenciones_agentes")
                .select("mdn_usuario, resultado")
                .eq("agente", agente.nombre)
                .eq("fecha", fecha);

              const totalDesabasto = registros?.length || 0;
              const totalAtendidos = atenciones?.length || 0;
              const efectivos = (atenciones || []).filter(
                (x) => x.resultado === "efectivo"
              ).length;

              totalRegionDesabasto += totalDesabasto;
              totalRegionAtendidos += totalAtendidos;
              totalRegionEfectivos += efectivos;
            })
          );

          const porcentajeAvance =
            totalRegionDesabasto > 0
              ? Math.round((totalRegionAtendidos / totalRegionDesabasto) * 100)
              : 0;

          const porcentajeEfectivos =
            totalRegionAtendidos > 0
              ? Math.round((totalRegionEfectivos / totalRegionAtendidos) * 100)
              : 0;

          totalGlobalDesabasto += totalRegionDesabasto;
          totalGlobalAtendidos += totalRegionAtendidos;
          totalGlobalEfectivos += totalRegionEfectivos;

          let colorBarra = "bg-red-600";
          if (porcentajeAvance >= 80 && porcentajeAvance < 100) colorBarra = "bg-yellow-400";
          else if (porcentajeAvance === 100) colorBarra = "bg-green-600";
          else if (porcentajeAvance >= 50) colorBarra = "bg-orange-500";

          return {
            region: regionKey,
            totalRegionDesabasto,
            totalRegionAtendidos,
            totalRegionEfectivos,
            porcentajeAvance,
            porcentajeEfectivos,
            colorBarra,
            semaforo: obtenerSemaforo(porcentajeAvance),
          };
        })
      );

      const porcentajeGlobal =
        totalGlobalDesabasto > 0
          ? Math.round((totalGlobalAtendidos / totalGlobalDesabasto) * 100)
          : 0;

      const porcentajeEfectivosGlobal =
        totalGlobalAtendidos > 0
          ? Math.round((totalGlobalEfectivos / totalGlobalAtendidos) * 100)
          : 0;

      let colorGlobal = "bg-red-600";
      if (porcentajeGlobal >= 80 && porcentajeGlobal < 100) colorGlobal = "bg-yellow-400";
      else if (porcentajeGlobal === 100) colorGlobal = "bg-green-600";
      else if (porcentajeGlobal >= 50) colorGlobal = "bg-orange-500";

      setResumenGlobal({
        totalGlobalDesabasto,
        totalGlobalAtendidos,
        totalGlobalEfectivos,
        porcentajeGlobal,
        porcentajeEfectivosGlobal,
        colorGlobal,
        semaforo: obtenerSemaforo(porcentajeGlobal),
      });

      setRegiones(regionesConDatos.sort((a, b) => b.porcentajeAvance - a.porcentajeAvance));
    } catch (e) {
      console.error("Error al cargar resumen global:", e.message);
      setResumenGlobal({});
      setRegiones([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Agentes de una región por fecha, con Avance y Efectividad de la región
  const cargarRegion = async (regionNorm, offsetDias = 0) => {
    setLoading(true);
    setRegionSeleccionada(regionNorm);
    setAgenteSeleccionado(null);
    setDetallesAgente(null);

    const fecha = isoNDiasAtras(offsetDias);

    const { data: agentesDataRaw } = await supabase
      .from("agentes")
      .select("*")
      .ilike("tipo", "%agente%")
      .eq("activo", true);

    const agentesRegionLocal = (agentesDataRaw || [])
      .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
      .filter((a) => a.region_norm === regionNorm && a.ruta_excel);

    let regionAtendidos = 0;
    let regionEfectivos = 0;
    let regionDesabasto = 0;

    const agentesConDatos = await Promise.all(
      agentesRegionLocal.map(async (agente) => {
        const { data: registros } = await supabase
          .from("vw_desabasto_unicos")
          .select(
            "mdn_usuario, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta"
          )
          .ilike("jerarquias_n3_ruta", `%${agente.ruta_excel}%`)
          .in("saldo_menor_al_promedio_diario", [
            "Menor al 25%",
            "Menor al 50%",
            "Menor al 75%",
          ])
          .gte("fecha_carga", `${fecha}T00:00:00`)
          .lte("fecha_carga", `${fecha}T23:59:59`);

        const { data: atenciones } = await supabase
          .from("atenciones_agentes")
          .select("mdn_usuario, resultado")
          .eq("agente", agente.nombre)
          .eq("fecha", fecha);

        const totalDesabasto = registros?.length || 0;
        const totalAtendidos = atenciones?.length || 0;
        const efectivos = (atenciones || []).filter(
          (x) => x.resultado === "efectivo"
        ).length;

        regionDesabasto += totalDesabasto;
        regionAtendidos += totalAtendidos;
        regionEfectivos += efectivos;

        const porcentajeAvance =
          totalDesabasto > 0 ? Math.round((totalAtendidos / totalDesabasto) * 100) : 0;

        let colorBarra = "bg-red-600";
        if (porcentajeAvance >= 80 && porcentajeAvance < 100) colorBarra = "bg-yellow-400";
        else if (porcentajeAvance === 100) colorBarra = "bg-green-600";
        else if (porcentajeAvance >= 50) colorBarra = "bg-orange-500";

        return {
          ...agente,
          totalDesabasto,
          totalAtendidos,
          efectivos,
          porcentajeAvance,
          colorBarra,
          semaforo: obtenerSemaforo(porcentajeAvance),
        };
      })
    );

    // Guardamos lista de agentes ordenada
    setAgentesRegion(agentesConDatos.sort((a, b) => b.porcentajeAvance - a.porcentajeAvance));

    // Guardamos resumen de región para encabezado de la vista "region"
    const porcentajeZona =
      regionDesabasto > 0 ? Math.round((regionAtendidos / regionDesabasto) * 100) : 0;
    const porcentajeEfectivosZona =
      regionAtendidos > 0 ? Math.round((regionEfectivos / regionAtendidos) * 100) : 0;

    setResumenGlobal((prev) => ({
      ...prev,
      // sobreescribimos temporalmente métricas de región seleccionada para el header de vista region
      regionResumenTemp: {
        region: regionNorm,
        totalRegionDesabasto: regionDesabasto,
        totalRegionAtendidos: regionAtendidos,
        totalRegionEfectivos: regionEfectivos,
        porcentajeZona,
        porcentajeEfectivosZona,
        colorZona:
          porcentajeZona >= 100
            ? "bg-green-600"
            : porcentajeZona >= 80
            ? "bg-yellow-400"
            : porcentajeZona >= 50
            ? "bg-orange-500"
            : "bg-red-600",
        semaforo: obtenerSemaforo(porcentajeZona),
      },
    }));

    setLoading(false);
    setVista("region");
  };
  // ==== (sigue en Parte 2) ====
  // Detalle del agente con pendientes, atendidos, avance y efectividad
  const cargarDetalleAgente = async (agente) => {
    setLoading(true);
    const fechaObjetivo = isoNDiasAtras(offsetDiasCtx);
    const inicio = `${fechaObjetivo}T00:00:00`;
    const fin = `${fechaObjetivo}T23:59:59`;

    const { data: registros } = await supabase
      .from("vw_desabasto_unicos")
      .select(
        "mdn_usuario, pdv, saldo, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta"
      )
      .ilike("jerarquias_n3_ruta", `%${agente.ruta_excel}%`)
      .in("saldo_menor_al_promedio_diario", [
        "Menor al 25%",
        "Menor al 50%",
        "Menor al 75%",
      ])
      .gte("fecha_carga", inicio)
      .lte("fecha_carga", fin);

    const { data: atenciones } = await supabase
      .from("atenciones_agentes")
      .select("id, mdn_usuario, pdv, hora, created_at, resultado, motivo_no_efectivo")
      .eq("agente", agente.nombre)
      .eq("fecha", fechaObjetivo);

    const atendidosIds = new Set((atenciones || []).map((a) => String(a.mdn_usuario)));

    const pendientes = (registros || [])
      .filter((r) => !atendidosIds.has(String(r.mdn_usuario)))
      .map((r) => {
        const t = (r.saldo_menor_al_promedio_diario || "").toLowerCase();
        let porcentaje = 100;
        if (t.includes("25")) porcentaje = 25;
        else if (t.includes("50")) porcentaje = 50;
        else if (t.includes("75")) porcentaje = 75;
        return { ...r, porcentaje, mdn_usuario: String(r.mdn_usuario) };
      })
      .sort((a, b) => a.porcentaje - b.porcentaje);

    const totalDesabasto = registros?.length || 0;
    const totalAtendidos = atenciones?.length || 0;
    const efectivos = (atenciones || []).filter((x) => x.resultado === "efectivo").length;
    const noEfectivos = (atenciones || []).filter((x) => x.resultado === "no efectivo").length;

    const porcentajeAvance =
      totalDesabasto > 0 ? Math.round((totalAtendidos / totalDesabasto) * 100) : 0;

    const porcentajeEfectivos =
      totalAtendidos > 0 ? Math.round((efectivos / totalAtendidos) * 100) : 0;

    let colorRuta = "bg-red-600";
    if (porcentajeAvance >= 80 && porcentajeAvance < 100) colorRuta = "bg-yellow-400";
    else if (porcentajeAvance === 100) colorRuta = "bg-green-600";
    else if (porcentajeAvance >= 50) colorRuta = "bg-orange-500";

    setDetallesAgente({
      pendientes,
      atenciones,
      totalDesabasto,
      totalAtendidos,
      efectivos,
      noEfectivos,
      porcentajeAvance,
      porcentajeEfectivos,
      colorRuta,
      semaforo: obtenerSemaforo(porcentajeAvance),
      fechaObjetivo,
    });

    setAgenteSeleccionado(agente);
    setLoading(false);
    setVista("agente");
  };

  // Histórico global (por región) últimos 7 días
  const cargarResumenHistorico = useCallback(async () => {
    setLoading(true);
    try {
      const { data: agentesDataRaw } = await supabase
        .from("agentes")
        .select("nombre, ruta_excel, region")
        .ilike("tipo", "%agente%")
        .eq("activo", true);

      const agentesData = (agentesDataRaw || [])
        .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
        .filter((a) => a.region_norm && a.ruta_excel);

      const dias = Array.from({ length: 7 }, (_, i) => isoNDiasAtras(6 - i));
      const historicoData = [];

      for (const fecha of dias) {
        const inicio = `${fecha}T00:00:00`;
        const fin = `${fecha}T23:59:59`;

        const { data: registrosDia } = await supabase
          .from("vw_desabasto_unicos")
          .select("jerarquias_n3_ruta, mdn_usuario, fecha_carga")
          .gte("fecha_carga", inicio)
          .lte("fecha_carga", fin);

        const { data: atencionesDia } = await supabase
          .from("atenciones_agentes")
          .select("agente, resultado, mdn_usuario, fecha")
          .eq("fecha", fecha);

        const regionesMap = {};
        (agentesData || []).forEach((ag) => {
          const desabastoAg =
            (registrosDia || []).filter((r) =>
              r.jerarquias_n3_ruta?.includes(ag.ruta_excel)
            ).length || 0;

          const atencionesAg = (atencionesDia || []).filter((a) => a.agente === ag.nombre);
          const atendidos = atencionesAg.length;
          const efectivos = atencionesAg.filter((a) => a.resultado === "efectivo").length;

          if (!regionesMap[ag.region_norm]) {
            regionesMap[ag.region_norm] = { desabasto: 0, atendidos: 0, efectivos: 0 };
          }
          regionesMap[ag.region_norm].desabasto += desabastoAg;
          regionesMap[ag.region_norm].atendidos += atendidos;
          regionesMap[ag.region_norm].efectivos += efectivos;
        });

        Object.entries(regionesMap).forEach(([region, vals]) => {
          const porcentajeAvance =
            vals.desabasto > 0 ? Math.round((vals.atendidos / vals.desabasto) * 100) : 0;
          const porcentajeEfectivos =
            vals.atendidos > 0 ? Math.round((vals.efectivos / vals.atendidos) * 100) : 0;

          historicoData.push({
            fecha,
            region,
            desabasto: vals.desabasto,
            atendidos: vals.atendidos,
            porcentajeAvance,
            porcentajeEfectivos,
          });
        });
      }

      const filtrados = historicoData.filter((r) => r.desabasto > 0 || r.atendidos > 0);
      setHistorico(filtrados);
      setFechaRango({ inicio: dias[0], fin: dias[dias.length - 1] });
    } catch (err) {
      console.error("Error histórico global:", err.message);
      setHistorico([]);
      setFechaRango({ inicio: null, fin: null });
    } finally {
      setLoading(false);
    }
  }, []);

  // Histórico por agentes en una región (7 días)
  const cargarResumenHistoricoRegion = async (regionNorm) => {
    setLoading(true);
    try {
      setRegionSeleccionada(regionNorm);

      const { data: agentesDataRaw } = await supabase
        .from("agentes")
        .select("nombre, ruta_excel, region")
        .ilike("tipo", "%agente%")
        .eq("activo", true);

      const agentesRegion = (agentesDataRaw || [])
        .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
        .filter((a) => a.region_norm === regionNorm && a.ruta_excel);

      const dias = Array.from({ length: 7 }, (_, i) => isoNDiasAtras(6 - i));
      const historicoData = [];

      for (const fecha of dias) {
        const inicio = `${fecha}T00:00:00`;
        const fin = `${fecha}T23:59:59`;

        const { data: registrosDia } = await supabase
          .from("vw_desabasto_unicos")
          .select("jerarquias_n3_ruta, mdn_usuario, fecha_carga")
          .gte("fecha_carga", inicio)
          .lte("fecha_carga", fin);

        const { data: atencionesDia } = await supabase
          .from("atenciones_agentes")
          .select("agente, resultado, mdn_usuario, fecha")
          .eq("fecha", fecha);

        agentesRegion.forEach((ag) => {
          const desabastoAg =
            (registrosDia || []).filter((r) =>
              r.jerarquias_n3_ruta?.includes(ag.ruta_excel)
            ).length || 0;

          const atencionesAg = (atencionesDia || []).filter((a) => a.agente === ag.nombre);
          const totalAtendidos = atencionesAg.length;
          const efectivos = atencionesAg.filter((a) => a.resultado === "efectivo").length;

          const porcentajeAvance =
            desabastoAg > 0 ? Math.round((totalAtendidos / desabastoAg) * 100) : 0;
          const porcentajeEfectivos =
            totalAtendidos > 0 ? Math.round((efectivos / totalAtendidos) * 100) : 0;

          historicoData.push({
            fecha,
            agente: ag.nombre,
            desabasto: desabastoAg,
            atendidos: totalAtendidos,
            porcentajeAvance,
            porcentajeEfectivos,
          });
        });
      }

      const filtrados = historicoData.filter((r) => r.desabasto > 0 || r.atendidos > 0);
      setHistoricoRegionAgentes(filtrados);
      setFechaRangoRegion({ inicio: dias[0], fin: dias[dias.length - 1] });
      setVista("historicoRegionAgentes");
    } catch (err) {
      console.error("Error histórico región-agentes:", err.message);
      setHistoricoRegionAgentes([]);
      setFechaRangoRegion({ inicio: null, fin: null });
    } finally {
      setLoading(false);
    }
  };

  // Cargas según vista
  useEffect(() => {
    if (vista === "menu") {
      setLoading(false);
      return;
    }
    if (vista === "actual") cargarResumenGlobalGenerico(0);
    if (vista === "anterior") cargarResumenGlobalGenerico(1);
    if (vista === "historico") cargarResumenHistorico();
  }, [vista, cargarResumenGlobalGenerico, cargarResumenHistorico]);
  // ===================== VISTAS =====================

  // ===== Menú principal =====
  if (vista === "menu") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
        <div className="flex flex-col justify-center items-center w-full max-w-md">
          <div className="bg-white shadow-lg rounded-3xl p-8 text-center w-full animate-fadeIn">
            <h2 className="text-xl font-semibold mb-6 text-gray-800">
              Supervisión Global — Todas las Regiones
            </h2>
            <div className="space-y-4">
              <button
                onClick={() => {
                  setOffsetDiasCtx(0);
                  setVista("actual");
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📊 Seguimiento Desabasto (Hoy)
              </button>
              <button
                onClick={() => {
                  setOffsetDiasCtx(1);
                  setVista("anterior");
                }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📅 Revisar Desabasto Día Anterior
              </button>
              <button
                onClick={() => setVista("historico")}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📈 Resumen de Avance por Región (7 días)
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== Vista: lista de regiones (hoy o ayer) =====
  if (vista === "actual" || vista === "anterior") {
    const {
      totalGlobalDesabasto = 0,
      totalGlobalAtendidos = 0,
      totalGlobalEfectivos = 0,
      porcentajeGlobal = 0,
      porcentajeEfectivosGlobal = 0,
      colorGlobal = "bg-red-600",
      semaforo = "🔴",
    } = resumenGlobal;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-6">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
          <div className="flex flex-col md:flex-row justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800 text-center md:text-left">
              {semaforo}{" "}
              {offsetDiasCtx === 1
                ? `Desabasto Día Anterior — Todas las Regiones (${formatSoloFechaCR(
                    isoNDiasAtras(1)
                  )})`
                : `Supervisión Global — Todas las Regiones (${formatSoloFechaCR(hoyISO())})`}
            </h2>

            <div className="flex gap-2 mt-2 md:mt-0">
              <button
                onClick={() => setVista("menu")}
                className="text-sm bg-gray-500 text-white py-1 px-3 rounded-lg hover:bg-gray-600"
              >
                ⬅ Menú
              </button>
              <button
                onClick={() => cargarResumenGlobalGenerico(offsetDiasCtx)}
                className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
              >
                🔄 Actualizar
              </button>
            </div>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div className={`${colorGlobal} h-4`} style={{ width: `${porcentajeGlobal}%` }} />
          </div>
          <p className="text-sm text-center text-gray-700 mb-6">
            Avance Global: {porcentajeGlobal}% | Efectividad:{" "}
            <span className="text-blue-600 font-semibold">
              {porcentajeEfectivosGlobal}%
            </span>{" "}
            — {totalGlobalAtendidos} de {totalGlobalDesabasto} PDV atendidos
          </p>

          {regiones.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow-sm text-center text-gray-600">
              No hay datos de regiones disponibles.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {regiones.map((r, i) => (
                <div
                  key={i}
                  className="rounded-xl shadow-md p-4 border border-gray-200 bg-white transition-transform hover:scale-[1.02]"
                >
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-1">
                    <span>{r.semaforo}</span> ZONA {r.region?.toUpperCase()}
                  </h3>
                  <div className="bg-gray-300 rounded-full h-3 overflow-hidden mb-2">
                    <div
                      className={`${r.colorBarra} h-3`}
                      style={{ width: `${r.porcentajeAvance}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-700 mb-2">
                    Avance: {r.porcentajeAvance}% |{" "}
                    <span className="text-blue-600 font-semibold">
                      Efectividad: {r.porcentajeEfectivos}%
                    </span>{" "}
                    — {r.totalRegionAtendidos} / {r.totalRegionDesabasto}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => cargarRegion(r.region, offsetDiasCtx)}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-4 rounded-lg w-full"
                    >
                      Ver región
                    </button>
                    <button
                      onClick={() => cargarResumenHistoricoRegion(r.region)}
                      className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 px-4 rounded-lg w-full"
                    >
                      Histórico 7 días (agentes)
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== Vista: agentes por región =====
  if (vista === "region" && regionSeleccionada) {
    const resumenTemp = resumenGlobal.regionResumenTemp || {};
    const {
      totalRegionDesabasto = 0,
      totalRegionAtendidos = 0,
      totalRegionEfectivos = 0,
      porcentajeZona = 0,
      porcentajeEfectivosZona = 0,
      colorZona = "bg-red-600",
      semaforo = "🔴",
    } = resumenTemp;

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-6">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
          <div className="flex flex-col md:flex-row justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800 text-center md:text-left">
              {semaforo} SUPERVISIÓN GLOBAL — {regionSeleccionada.toUpperCase()} (
              {formatSoloFechaCR(isoNDiasAtras(offsetDiasCtx))})
            </h2>

            <div className="flex gap-2 mt-2 md:mt-0">
              <button
                onClick={() => {
                  setRegionSeleccionada(null);
                  setAgentesRegion([]);
                  setVista(offsetDiasCtx === 1 ? "anterior" : "actual");
                }}
                className="text-sm bg-gray-500 text-white py-1 px-3 rounded-lg hover:bg-gray-600"
              >
                ⬅ Regiones
              </button>
              <button
                onClick={() => cargarRegion(regionSeleccionada, offsetDiasCtx)}
                className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
              >
                🔄 Actualizar
              </button>
            </div>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div className={`${colorZona} h-4`} style={{ width: `${porcentajeZona}%` }} />
          </div>
          <p className="text-sm text-center text-gray-700 mb-4">
            Avance: {porcentajeZona}% |{" "}
            <span className="text-blue-600 font-semibold">
              Efectividad: {porcentajeEfectivosZona}%
            </span>{" "}
            — {totalRegionAtendidos} / {totalRegionDesabasto} PDV atendidos
          </p>

          {agentesRegion.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow-sm text-center text-gray-600">
              No hay agentes en esta región.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {agentesRegion.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl shadow-md p-4 border border-gray-200 bg-white transition-transform hover:scale-[1.02]"
                >
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span>{a.semaforo}</span> {a.nombre}
                  </h3>
                  <p className="text-xs text-gray-500 mb-1">Ruta {a.ruta_excel}</p>
                  <div className="bg-gray-300 rounded-full h-3 overflow-hidden mb-2">
                    <div
                      className={`${a.colorBarra} h-3`}
                      style={{ width: `${a.porcentajeAvance}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-700 mb-2">
                    Avance: {a.porcentajeAvance}% |{" "}
                    <span className="text-blue-600 font-semibold">
                      Efectividad:{" "}
                      {a.totalAtendidos > 0
                        ? Math.round((a.efectivos / a.totalAtendidos) * 100)
                        : 0}
                      %
                    </span>{" "}
                    — {a.totalAtendidos} / {a.totalDesabasto}
                  </p>
                  <button
                    onClick={() => cargarDetalleAgente(a)}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-4 rounded-lg w-full"
                  >
                    Ver detalles
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
  // ===== Vista: detalle del agente =====
  if (vista === "agente" && detallesAgente && agenteSeleccionado && regionSeleccionada) {
    const {
      pendientes,
      atenciones,
      totalDesabasto,
      totalAtendidos,
      efectivos,
      noEfectivos,
      porcentajeAvance,
      porcentajeEfectivos,
      colorRuta,
      semaforo,
      fechaObjetivo,
    } = detallesAgente;

    const formatHora = (a) => {
      if (a.hora) return a.hora;
      try {
        return new Date(a.created_at).toLocaleTimeString("es-CR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: TZ,
        });
      } catch {
        return "";
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 py-6">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-4xl animate-fadeIn">
          <div className="flex flex-col md:flex-row justify-between items-center mb-2">
            <h2 className="text-lg font-semibold text-gray-800 text-center md:text-left">
              {semaforo} SUPERVISIÓN — {regionSeleccionada.toUpperCase()} — {agenteSeleccionado.nombre}
            </h2>
            <div className="flex gap-2 mt-2 md:mt-0">
              <button
                onClick={() => {
                  setDetallesAgente(null);
                  setVista("region");
                }}
                className="text-sm bg-gray-500 text-white py-1 px-3 rounded-lg hover:bg-gray-600"
              >
                ⬅ Agentes
              </button>
              <button
                onClick={() => cargarDetalleAgente(agenteSeleccionado)}
                className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
              >
                🔄 Actualizar
              </button>
            </div>
          </div>

          <p className="text-xs text-gray-500 mb-3">
            Fecha: {formatSoloFechaCR(fechaObjetivo)}
          </p>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div className={`${colorRuta} h-4`} style={{ width: `${porcentajeAvance}%` }} />
          </div>
          <p className="text-sm text-center text-gray-700 mb-4">
            Avance: {porcentajeAvance}% |{" "}
            <span className="text-blue-600 font-semibold">
              Efectividad: {porcentajeEfectivos}%
            </span>{" "}
            — {totalAtendidos} de {totalDesabasto} PDV atendidos
          </p>

          {pendientes.length === 0 ? (
            <p className="text-center text-gray-600 mt-4">Todos los PDV fueron atendidos ✅</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pendientes.map((pdv, i) => (
                <div key={i} className="rounded-xl shadow-md p-4 border border-gray-200 bg-white">
                  <p className="text-xs text-gray-500">MDN: {pdv.mdn_usuario}</p>
                  <h3 className="text-base font-bold text-gray-800">{pdv.pdv}</h3>
                  <p className="text-sm text-gray-700 mb-1">
                    Saldo: {formatCRC(pdv.saldo)}
                  </p>
                  <p
                    className={`text-xs font-semibold ${
                      pdv.porcentaje === 25
                        ? "text-red-600"
                        : pdv.porcentaje === 50
                        ? "text-orange-500"
                        : "text-yellow-500"
                    }`}
                  >
                    Desabasto: {pdv.porcentaje} %
                  </p>
                </div>
              ))}
            </div>
          )}

          {atenciones.length > 0 && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 shadow p-4 mt-6 text-center">
              <h3 className="text-md font-semibold text-gray-800 mb-2">Resumen del día</h3>
              <div className="flex justify-around text-sm font-semibold">
                <p className="text-green-600">🟢 Efectivos: {efectivos}</p>
                <p className="text-red-600">🔴 No efectivos: {noEfectivos}</p>
              </div>
            </div>
          )}

          {atenciones.length > 0 && (
            <div className="mt-6 bg-gray-50 rounded-xl border border-gray-200 shadow p-4">
              <h3 className="text-md font-semibold text-gray-800 text-center mb-2">
                PDV Atendidos ({atenciones.length})
              </h3>
              <div className="divide-y divide-gray-200">
                {atenciones.map((a) => (
                  <div
                    key={a.id}
                    className="py-2 text-sm text-gray-700 flex justify-between items-center"
                  >
                    <div>
                      <p className="font-semibold flex items-center gap-2">
                        {a.pdv}
                        {a.resultado === "efectivo" && (
                          <span className="w-3 h-3 bg-green-500 rounded-full" />
                        )}
                        {a.resultado === "no efectivo" && (
                          <span className="w-3 h-3 bg-red-500 rounded-full" />
                        )}
                      </p>
                      <p className="text-xs text-gray-500">MDN: {a.mdn_usuario}</p>
                      {a.resultado === "no efectivo" && a.motivo_no_efectivo && (
                        <p className="text-xs text-gray-600 italic">
                          Motivo: {a.motivo_no_efectivo}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-600">{formatHora(a)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== Vista: histórico global por región =====
  if (vista === "historico") {
    const grupos = historico.reduce((acc, r) => {
      if (!acc[r.region]) acc[r.region] = [];
      acc[r.region].push(r);
      return acc;
    }, {});

    const regionesOrdenadas = Object.entries(grupos)
      .map(([region, registros]) => {
        const avgAvance =
          registros.reduce((s, r) => s + (r.porcentajeAvance || 0), 0) / registros.length;
        const avgEfectivos =
          registros.reduce((s, r) => s + (r.porcentajeEfectivos || 0), 0) / registros.length;
        return {
          region,
          registros,
          avgAvance: Math.round(avgAvance),
          avgEfectivos: Math.round(avgEfectivos),
        };
      })
      .sort((a, b) => b.avgAvance - a.avgAvance);

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                📈 Resumen Histórico — Últimos 7 días
              </h2>
              {fechaRango.inicio && fechaRango.fin && (
                <p className="text-sm text-gray-600 mt-1">
                  📆 {formatSoloFechaCR(fechaRango.inicio)} a{" "}
                  {formatSoloFechaCR(fechaRango.fin)}
                </p>
              )}
            </div>
            <button
              onClick={() => setVista("menu")}
              className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
            >
              ⬅ Menú
            </button>
          </div>

          {loading ? (
            <p className="text-center text-gray-500 mt-4">Cargando...</p>
          ) : regionesOrdenadas.length === 0 ? (
            <p className="text-center text-gray-500 mt-4">No hay datos históricos disponibles.</p>
          ) : (
            regionesOrdenadas.map((rg, idx) => (
              <div key={rg.region} className="mb-6 border-t border-gray-300 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-bold text-gray-800">
                    {idx + 1}. 🗺️ Región {rg.region}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Avance:{" "}
                    <span className="font-semibold text-green-600">{rg.avgAvance}%</span> |{" "}
                    Efectividad:{" "}
                    <span className="font-semibold text-blue-600">{rg.avgEfectivos}%</span>
                  </p>
                </div>

                <div className="overflow-x-auto border rounded-lg shadow-sm">
                  <table className="min-w-[600px] w-full text-sm border-collapse">
                    <thead className="bg-gray-200 text-gray-800">
                      <tr>
                        <th className="p-2 text-left">Fecha</th>
                        <th className="p-2 text-center">Desabasto</th>
                        <th className="p-2 text-center">Atendidos</th>
                        <th className="p-2 text-center">% Avance</th>
                        <th className="p-2 text-center">% Efectivos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rg.registros.map((r, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2">{formatSoloFechaCR(r.fecha)}</td>
                          <td className="p-2 text-center">{r.desabasto}</td>
                          <td className="p-2 text-center">{r.atendidos}</td>
                          <td className="p-2 text-center text-green-600 font-semibold">
                            {r.porcentajeAvance}%
                          </td>
                          <td className="p-2 text-center text-blue-600 font-semibold">
                            {r.porcentajeEfectivos}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ===== Vista: histórico por agentes de una región =====
  if (vista === "historicoRegionAgentes" && regionSeleccionada) {
    const grupos = historicoRegionAgentes.reduce((acc, r) => {
      if (!acc[r.agente]) acc[r.agente] = [];
      acc[r.agente].push(r);
      return acc;
    }, {});

    const agentesOrdenados = Object.entries(grupos)
      .map(([agente, registros]) => {
        const avgAvance =
          registros.reduce((s, r) => s + (r.porcentajeAvance || 0), 0) / registros.length;
        const avgEfectivos =
          registros.reduce((s, r) => s + (r.porcentajeEfectivos || 0), 0) / registros.length;
        return {
          agente,
          registros,
          avgAvance: Math.round(avgAvance),
          avgEfectivos: Math.round(avgEfectivos),
        };
      })
      .sort((a, b) => b.avgAvance - a.avgAvance);

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800">
              📈 Histórico — Región {regionSeleccionada} (7 días)
            </h2>
            <button
              onClick={() => setVista("historico")}
              className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
            >
              ⬅ Volver
            </button>
          </div>

          {loading ? (
            <p className="text-center text-gray-500 mt-4">Cargando...</p>
          ) : (
            agentesOrdenados.map((ag, idx) => (
              <div key={ag.agente} className="mb-6 border-t border-gray-300 pt-4">
                <h3 className="text-md font-bold text-gray-800 mb-2">
                  {idx + 1}. 👤 {ag.agente} — Avance {ag.avgAvance}% |{" "}
                  <span className="text-blue-600">Efectividad {ag.avgEfectivos}%</span>
                </h3>
                <div className="overflow-x-auto border rounded-lg shadow-sm">
                  <table className="min-w-[600px] w-full text-sm border-collapse">
                    <thead className="bg-gray-200 text-gray-800">
                      <tr>
                        <th className="p-2 text-left">Fecha</th>
                        <th className="p-2 text-center">Desabasto</th>
                        <th className="p-2 text-center">Atendidos</th>
                        <th className="p-2 text-center">% Avance</th>
                        <th className="p-2 text-center">% Efectivos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ag.registros.map((r, i) => (
                        <tr key={i} className="border-b hover:bg-gray-50">
                          <td className="p-2">{formatSoloFechaCR(r.fecha)}</td>
                          <td className="p-2 text-center">{r.desabasto}</td>
                          <td className="p-2 text-center">{r.atendidos}</td>
                          <td className="p-2 text-center text-green-600 font-semibold">
                            {r.porcentajeAvance}%
                          </td>
                          <td className="p-2 text-center text-blue-600 font-semibold">
                            {r.porcentajeEfectivos}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // ===== Cierre general =====
  if (loading) {
    return <p className="text-center text-gray-500 mt-6">Cargando información...</p>;
  }

  return null;
}
