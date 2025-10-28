/* eslint-disable no-unused-vars */
/* ============================================================================
   GlobalSupervisorMenu.jsx
   - Menú y vistas de Supervisión Global
   - Vistas: menu | actual | anterior | historico | region | agente
             | historicoRegionAgentes | resumenMotivos | resumenMotivosRegion
             | adminTools   ← NUEVA
   - Incluye resumen de motivos de no compra (7 días) por región y por agente
   ============================================================================ */

import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";
import AdminToolsPanel from "./AdminToolsPanel";

/* ============================================================================
   Componente principal
   ============================================================================ */
export default function GlobalSupervisorMenu({ usuario }) {

  /* --------------------------------------------------------------------------
     Vistas y contexto
     -------------------------------------------------------------------------- */
  // Vistas: menu | actual | anterior | historico | region | agente | historicoRegionAgentes
  //         resumenMotivos | resumenMotivosRegion | adminTools
  const [vista, setVista] = useState("menu");

  // Contexto de fecha para vistas "actual" y "anterior": 0 = hoy, 1 = ayer (CR).
  const [offsetDiasCtx, setOffsetDiasCtx] = useState(0);

  // NUEVO: fecha fijada cuando vista = "anterior" (omitiendo domingos)
  const [fechaFijadaCtx, setFechaFijadaCtx] = useState(null);

  // Métrica Liberty (último control_registro)
  const [metricaLiberty, setMetricaLiberty] = useState(null);

  /* --------------------------------------------------------------------------
     Estados globales
     -------------------------------------------------------------------------- */
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

  // Resumen de motivos (7 días)
  const [resumenMotivos, setResumenMotivos] = useState([]); // por región
  const [resumenMotivosRegion, setResumenMotivosRegion] = useState([]); // por agente (de una región)

  /* --------------------------------------------------------------------------
     Cálculo de superadmin (no rompe flujos existentes)
     -------------------------------------------------------------------------- */
  const isSuperAdmin = (() => {
    const a = String(usuario?.acceso || "").toLowerCase();
    const r = String(usuario?.rol || "").toLowerCase();
    const t = String(usuario?.tipo || "").toLowerCase();
    const sup = String(usuario?.supervisor || "").toLowerCase();
    const flag = Boolean(usuario?.superadmin === true);
    return (
      a === "superadmin" ||
      r === "superadmin" ||
      flag ||
      (t === "supervisor" && sup === "superadmin")
    );
  })();

  /* --------------------------------------------------------------------------
     Zona horaria y helpers de fecha
     -------------------------------------------------------------------------- */
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
    const [y, m, d] = (iso || "").split("-").map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  };

  const formatFechaCortoCR = (iso) =>
    parseISOasCRDate(iso).toLocaleDateString("es-CR", {
      timeZone: TZ,
      day: "2-digit",
      month: "short",
    });

  const formatFechaLargoCR = (iso) =>
    parseISOasCRDate(iso).toLocaleDateString("es-CR", {
      timeZone: TZ,
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  /* --------------------------------------------------------------------------
     Visual y formateo
     -------------------------------------------------------------------------- */
  const obtenerSemaforo = (p) => {
    if (p === 100) return "🟢";
    if (p >= 80) return "🟡";
    if (p >= 50) return "🟠";
    return "🔴";
  };

  const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) return "N/D";
    return parseFloat(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const normalizarRegion = (r) => {
    const n = (r || "").trim().toLowerCase();
    if (!n) return null;
    if (n.includes("oficina")) return null;
    if (n === "gte" || n === "gte altura" || n === "gte bajura") return "GTE";
    if (n.includes("zona norte") || n === "norte") return "NORTE";
    if (n === "gam") return "GAM";
    return (r || "").toUpperCase();
  };

  /* --------------------------------------------------------------------------
     Utilitario: ajustar % de motivos a 100.00
     -------------------------------------------------------------------------- */
  const ajustarPorcentajes100 = (items) => {
    const positivos = (items || [])
      .map((x) => ({
        motivo: x.motivo,
        porcentaje: parseFloat(x.porcentaje || 0),
        count: x.count || 0,
      }))
      .filter((x) => x.porcentaje > 0);

    if (positivos.length === 0) return [];

    let arr = positivos.map((x) => ({
      ...x,
      porcentaje: parseFloat(x.porcentaje.toFixed(2)),
    }));
    arr.sort((a, b) => b.porcentaje - a.porcentaje);

    let suma = arr.reduce((s, x) => s + x.porcentaje, 0);
    const diff = parseFloat((100 - suma).toFixed(2));
    if (Math.abs(diff) >= 0.01) {
      arr[arr.length - 1].porcentaje = parseFloat(
        (arr[arr.length - 1].porcentaje + diff).toFixed(2)
      );
    }
    if (arr[arr.length - 1].porcentaje < 0) {
      arr[arr.length - 1].porcentaje = 0;
      const nuevaSuma = arr.reduce((s, x) => s + x.porcentaje, 0);
      const diff2 = parseFloat((100 - nuevaSuma).toFixed(2));
      arr[0].porcentaje = parseFloat((arr[0].porcentaje + diff2).toFixed(2));
    }

    arr.sort((a, b) => b.porcentaje - a.porcentaje);
    return arr;
  };

  /* ============================================================================
     CARGAS
     ============================================================================ */

  // Resumen global por fecha (hoy o fecha forzada) con efectividad
const cargarResumenGlobalGenerico = useCallback(
  async (offsetDias = 0, fechaForzada = null) => {
    setLoading(true);

    // Forzar misma fecha para vw_desabasto_unicos y atenciones_agentes
    const fechaReferencia = fechaForzada ?? isoNDiasAtras(offsetDias);
    const inicio = `${fechaReferencia}T00:00:00`;
    const fin = `${fechaReferencia}T23:59:59`;

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
              // Desabasto del día (mismo rango horario)
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
                .gte("fecha_carga", inicio)
                .lte("fecha_carga", fin);

              // Atenciones del mismo día
              const { data: atenciones } = await supabase
                .from("atenciones_agentes")
                .select("mdn_usuario, resultado")
                .eq("agente", agente.nombre)
                .gte("fecha", inicio)
                .lte("fecha", fin);

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

          const porcentajeEfectividad =
            totalRegionAtendidos > 0
              ? Math.round((totalRegionEfectivos / totalRegionAtendidos) * 100)
              : 0;

          totalGlobalDesabasto += totalRegionDesabasto;
          totalGlobalAtendidos += totalRegionAtendidos;
          totalGlobalEfectivos += totalRegionEfectivos;

          return {
            region: regionKey,
            totalRegionDesabasto,
            totalRegionAtendidos,
            totalRegionEfectivos,
            porcentajeAvance,
            porcentajeEfectividad,
            semaforo: obtenerSemaforo(porcentajeAvance),
          };
        })
      );

      const porcentajeGlobal =
        totalGlobalDesabasto > 0
          ? Math.round((totalGlobalAtendidos / totalGlobalDesabasto) * 100)
          : 0;

      const porcentajeGlobalEfectividad =
        totalGlobalAtendidos > 0
          ? Math.round((totalGlobalEfectivos / totalGlobalAtendidos) * 100)
          : 0;

      setResumenGlobal({
        totalGlobalDesabasto,
        totalGlobalAtendidos,
        totalGlobalEfectivos,
        porcentajeGlobal,
        porcentajeGlobalEfectividad,
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
  },
  []
);


  // Agentes de una región por fecha con efectividad
  const cargarRegion = async (regionNorm, offsetDias = 0) => {
    setLoading(true);
    setRegionSeleccionada(regionNorm);
    setAgenteSeleccionado(null);
    setDetallesAgente(null);

    const fecha = fechaFijadaCtx ?? isoNDiasAtras(offsetDias);

    const { data: agentesDataRaw } = await supabase
      .from("agentes")
      .select("*")
      .ilike("tipo", "%agente%")
      .eq("activo", true);

    const agentesRegionLocal = (agentesDataRaw || [])
      .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
      .filter((a) => a.region_norm === regionNorm && a.ruta_excel);

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
        const efectivos = (atenciones || []).filter((x) => x.resultado === "efectivo").length;

        const porcentajeAvance =
          totalDesabasto > 0 ? Math.round((totalAtendidos / totalDesabasto) * 100) : 0;

        const porcentajeEfectividad =
          totalAtendidos > 0 ? Math.round((efectivos / totalAtendidos) * 100) : 0;

        return {
          ...agente,
          totalDesabasto,
          totalAtendidos,
          efectivos,
          porcentajeAvance,
          porcentajeEfectividad,
          semaforo: obtenerSemaforo(porcentajeAvance),
        };
      })
    );

    setAgentesRegion(agentesConDatos.sort((a, b) => b.porcentajeAvance - a.porcentajeAvance));
    setLoading(false);
    setVista("region");
  };

  // Detalle de agente (hoy o fecha fijada si aplica)
  const cargarDetalleAgente = async (agente) => {
    setLoading(true);
    try {
      const fecha = fechaFijadaCtx ?? isoNDiasAtras(offsetDiasCtx);

      const inicio = `${fecha}T00:00:00`;
      const fin = `${fecha}T23:59:59`;

      const { data: registrosDia, error: errReg } = await supabase
        .from("vw_desabasto_unicos")
        .select(
          "mdn_usuario, pdv, saldo, promedio_semanal, fecha_ultima_compra, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta"
        )
        .ilike("jerarquias_n3_ruta", `%${agente.ruta_excel}%`)
        .in("saldo_menor_al_promedio_diario", [
          "Menor al 25%",
          "Menor al 50%",
          "Menor al 75%",
        ])
        .gte("fecha_carga", inicio)
        .lte("fecha_carga", fin);

      if (errReg) throw errReg;

      const { data: atencionesDia, error: errAt } = await supabase
        .from("atenciones_agentes")
        .select(
          "id, mdn_usuario, pdv, hora, created_at, resultado, motivo_no_efectivo, fecha"
        )
        .eq("agente", agente.nombre)
        .eq("fecha", fecha);

      if (errAt) throw errAt;

      const atendidosIds = new Set(atencionesDia.map((a) => String(a.mdn_usuario)));

      const pendientes = (registrosDia || [])
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

      const totalDesabasto = registrosDia?.length || 0;
      const totalAtendidos = atencionesDia?.length || 0;
      const efectivos = (atencionesDia || []).filter((a) => a.resultado === "efectivo").length;
      const noEfectivos = (atencionesDia || []).filter((a) => a.resultado === "no efectivo").length;

      const porcentajeAvance =
        totalDesabasto > 0 ? Math.round((totalAtendidos / totalDesabasto) * 100) : 0;
      const porcentajeEfectividad =
        totalAtendidos > 0 ? Math.round((efectivos / totalAtendidos) * 100) : 0;
      const porcentajeNoEfectivos =
        totalAtendidos > 0 ? Math.round((noEfectivos / totalAtendidos) * 100) : 0;

      let colorRuta = "bg-red-600";
      if (porcentajeAvance >= 80 && porcentajeAvance < 100) colorRuta = "bg-yellow-400";
      else if (porcentajeAvance === 100) colorRuta = "bg-green-600";
      else if (porcentajeAvance >= 50) colorRuta = "bg-orange-500";

      setDetallesAgente({
        pendientes,
        atenciones: atencionesDia,
        totalDesabasto,
        totalAtendidos,
        efectivos,
        noEfectivos,
        porcentajeAvance,
        porcentajeEfectividad,
        porcentajeNoEfectivos,
        colorRuta,
        semaforo: obtenerSemaforo(porcentajeAvance),
        inicio7d: fecha,
        fin7d: fecha,
      });

      setAgenteSeleccionado(agente);
      setVista("agente");
    } catch (err) {
      console.error("Error en cargarDetalleAgente:", err.message);
      setDetallesAgente(null);
    } finally {
      setLoading(false);
    }
  };
  // Histórico global (por región) 7 días
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
            efectivos,
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

  /* ===================== Resumen de motivos (7 días) ===================== */
  const cargarResumenMotivos = useCallback(async () => {
    setLoading(true);
    try {
      const { data: agentes } = await supabase
        .from("agentes")
        .select("nombre, ruta_excel, region")
        .ilike("tipo", "%agente%")
        .eq("activo", true);

      const agentesData = (agentes || [])
        .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
        .filter((a) => a.region_norm && a.ruta_excel);

      const dias = Array.from({ length: 7 }, (_, i) => isoNDiasAtras(6 - i));
      const resumen = {};

      for (const fecha of dias) {
        const { data: registrosDia } = await supabase
          .from("vw_desabasto_unicos")
          .select("jerarquias_n3_ruta, mdn_usuario")
          .gte("fecha_carga", `${fecha}T00:00:00`)
          .lte("fecha_carga", `${fecha}T23:59:59`);

        const { data: atencionesDia } = await supabase
          .from("atenciones_agentes")
          .select("agente, resultado, motivo_no_efectivo")
          .eq("fecha", fecha);

        agentesData.forEach((ag) => {
          const region = ag.region_norm;
          if (!resumen[region])
            resumen[region] = {
              region,
              desabasto: 0,
              atendidos: 0,
              efectivos: 0,
              noefectivos: 0,
              motivos: {},
            };

          const desabastoAg = (registrosDia || []).filter((r) =>
            r.jerarquias_n3_ruta?.includes(ag.ruta_excel)
          ).length;

          const atencionesAg = (atencionesDia || []).filter((a) => a.agente === ag.nombre);
          const efectivos = atencionesAg.filter((a) => a.resultado === "efectivo").length;
          const noefectivos = atencionesAg.filter((a) => a.resultado === "no efectivo").length;

          resumen[region].desabasto += desabastoAg;
          resumen[region].atendidos += atencionesAg.length;
          resumen[region].efectivos += efectivos;
          resumen[region].noefectivos += noefectivos;

          atencionesAg.forEach((a) => {
            if (a.resultado === "no efectivo" && a.motivo_no_efectivo) {
              const m = a.motivo_no_efectivo.trim();
              if (!resumen[region].motivos[m]) resumen[region].motivos[m] = 0;
              resumen[region].motivos[m] += 1;
            }
          });
        });
      }

      const regionesProcesadas = Object.values(resumen).map((r) => {
        const motivosArray = Object.entries(r.motivos || {});
        const totalNoEf = motivosArray.reduce((s, [, v]) => s + v, 0);

        const motivosPorcentaje = motivosArray.map(([m, v]) => ({
          motivo: m,
          count: v,
          porcentaje: totalNoEf ? ((v / totalNoEf) * 100).toFixed(2) : "0.00",
        }));

        const porcentajeEfectivos =
          r.atendidos > 0 ? Math.round((r.efectivos / r.atendidos) * 100) : 0;
        const porcentajeNoEfectivos =
          r.atendidos > 0 ? Math.round((r.noefectivos / r.atendidos) * 100) : 0;

        return {
          ...r,
          porcentajeEfectivos,
          porcentajeNoEfectivos,
          motivosPorcentaje: ajustarPorcentajes100(motivosPorcentaje),
        };
      });

      regionesProcesadas.sort((a, b) => (b.porcentajeNoEfectivos || 0) - (a.porcentajeNoEfectivos || 0));

      setResumenMotivos(regionesProcesadas);
      setFechaRango({
        inicio: dias[0],
        fin: dias[dias.length - 1],
      });
      setVista("resumenMotivos");
    } catch (err) {
      console.error("Error resumen motivos:", err.message);
      setResumenMotivos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Resumen de motivos por región → detalle por agentes (7 días)
  const cargarResumenMotivosRegion = async (regionNorm) => {
    setLoading(true);
    try {
      setRegionSeleccionada(regionNorm);

      const { data: agentes } = await supabase
        .from("agentes")
        .select("nombre, ruta_excel, region")
        .ilike("tipo", "%agente%")
        .eq("activo", true);

      const agentesRegion = (agentes || [])
        .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
        .filter((a) => a.region_norm === regionNorm && a.ruta_excel);

      const dias = Array.from({ length: 7 }, (_, i) => isoNDiasAtras(6 - i));
      const resumenAgentes = {};

      for (const fecha of dias) {
        const { data: registrosDia } = await supabase
          .from("vw_desabasto_unicos")
          .select("jerarquias_n3_ruta, mdn_usuario")
          .gte("fecha_carga", `${fecha}T00:00:00`)
          .lte("fecha_carga", `${fecha}T23:59:59`);

        const { data: atencionesDia } = await supabase
          .from("atenciones_agentes")
          .select("agente, resultado, motivo_no_efectivo")
          .eq("fecha", fecha);

        agentesRegion.forEach((ag) => {
          const agKey = ag.nombre;
          if (!resumenAgentes[agKey])
            resumenAgentes[agKey] = {
              agente: agKey,
              desabasto: 0,
              atendidos: 0,
              efectivos: 0,
              noefectivos: 0,
              motivos: {},
            };

          const desabastoAg = (registrosDia || []).filter((r) =>
            r.jerarquias_n3_ruta?.includes(ag.ruta_excel)
          ).length;

          const atencionesAg = (atencionesDia || []).filter((a) => a.agente === ag.nombre);
          const efectivos = atencionesAg.filter((a) => a.resultado === "efectivo").length;
          const noefectivos = atencionesAg.filter((a) => a.resultado === "no efectivo").length;

          resumenAgentes[agKey].desabasto += desabastoAg;
          resumenAgentes[agKey].atendidos += atencionesAg.length;
          resumenAgentes[agKey].efectivos += efectivos;
          resumenAgentes[agKey].noefectivos += noefectivos;

          atencionesAg.forEach((a) => {
            if (a.resultado === "no efectivo" && a.motivo_no_efectivo) {
              const m = a.motivo_no_efectivo.trim();
              if (!resumenAgentes[agKey].motivos[m]) resumenAgentes[agKey].motivos[m] = 0;
              resumenAgentes[agKey].motivos[m] += 1;
            }
          });
        });
      }

      const agentesProcesados = Object.values(resumenAgentes).map((a) => {
        const motivosArray = Object.entries(a.motivos || {});
        const totalNoEf = motivosArray.reduce((s, [, v]) => s + v, 0);

        const motivosPorcentaje = motivosArray.map(([m, v]) => ({
          motivo: m,
          count: v,
          porcentaje: totalNoEf ? ((v / totalNoEf) * 100).toFixed(2) : "0.00",
        }));

        const porcentajeEfectivos =
          a.atendidos > 0 ? Math.round((a.efectivos / a.atendidos) * 100) : 0;
        const porcentajeNoEfectivos =
          a.atendidos > 0 ? Math.round((a.noefectivos / a.atendidos) * 100) : 0;

        return {
          ...a,
          porcentajeEfectivos,
          porcentajeNoEfectivos,
          motivosPorcentaje: ajustarPorcentajes100(motivosPorcentaje),
        };
      });

      agentesProcesados.sort((a, b) => (b.porcentajeNoEfectivos || 0) - (a.porcentajeNoEfectivos || 0));

      setResumenMotivosRegion(agentesProcesados);
      setVista("resumenMotivosRegion");
    } catch (err) {
      console.error("Error resumen motivos región:", err.message);
      setResumenMotivosRegion([]);
    } finally {
      setLoading(false);
    }
  };

  // === NUEVO: última fecha laborable (lunes a sábado, excluyendo hoy) ===
  const obtenerUltimaFechaLaborable = async () => {
    try {
      // Obtener todas las fechas de atenciones ordenadas descendente
      const { data, error } = await supabase
        .from("atenciones_agentes")
        .select("fecha")
        .order("fecha", { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) return null;

      // Fecha de hoy en Costa Rica (para excluirla)
      const hoyCR = new Date(
        new Date().toLocaleString("en-US", { timeZone: TZ })
      );
      const hoyISO = hoyCR.toISOString().split("T")[0];

      const esDomingoCR = (iso) => {
        const base = `${iso.split("T")[0]}T12:00:00Z`; // mediodía UTC
        const dCR = new Date(new Date(base).toLocaleString("en-US", { timeZone: TZ }));
        const day = dCR.getDay(); // 0=domingo, 1=lunes...
        return day === 0;
      };

      // Buscar la última fecha que:
      //  - no sea hoy
      //  - no sea domingo
      for (const r of data) {
        const iso = r.fecha.split("T")[0];
        if (iso === hoyISO) continue; // saltar hoy
        if (!esDomingoCR(iso)) return iso;
      }

      return null;
    } catch (err) {
      console.error("Error al obtener última fecha laborable:", err.message);
      return null;
    }
  };

  /* ===================== Cargas automáticas por vista ===================== */
  useEffect(() => {
    if (vista === "menu") {
      setLoading(false);
      return;
    }

    if (vista === "actual") {
      setFechaFijadaCtx(null);
      cargarResumenGlobalGenerico(0, null);
      return;
    }

    if (vista === "anterior") {
      (async () => {
        const ultimaFechaLab = await obtenerUltimaFechaLaborable();
        if (ultimaFechaLab) {
          setFechaFijadaCtx(ultimaFechaLab);
          await cargarResumenGlobalGenerico(0, ultimaFechaLab);
        } else {
          setFechaFijadaCtx(null);
          await cargarResumenGlobalGenerico(1, null);
        }
      })();
      return;
    }

    if (vista === "historico") {
      cargarResumenHistorico();
      return;
    }
  }, [vista, cargarResumenGlobalGenerico, cargarResumenHistorico]);
  /* ============================== RENDERS ============================== */

  // NUEVO: Vista AdminTools (solo superadmin)
  if (vista === "adminTools") {
    return <AdminToolsPanel onVolver={() => setVista("menu")} />;
  }

  // Menú principal
  if (vista === "menu") {
    return (
      <div className="min-h-screen sm:min-h-[90vh] flex items-start sm:items-center justify-center bg-gray-100 px-4 py-6 sm:py-10 overflow-hidden">
        <div className="flex flex-col justify-center items-center w-full px-4">
          <div className="bg-white shadow-lg rounded-3xl p-8 text-center max-w-md w-full transform transition-all animate-fadeIn sm:mt-[-250px]">
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
                📅 Revisar Desabasto último día de atención
              </button>

              <button
                onClick={() => setVista("historico")}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📈 Resumen por Región (7 días)
              </button>

              <button
                onClick={() => cargarResumenMotivos()}
                className="w-full bg-orange-600 hover:bg-orange-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📊 Resumen Razones No Compra (7 días)
              </button>

              {/* === NUEVO: Botón visible solo para súper admin === */}
              {isSuperAdmin && (
                <button
                  onClick={() => setVista("adminTools")}
                  className="w-full bg-slate-800 hover:bg-slate-900 text-white py-3 px-4 rounded-lg font-semibold"
                  title="Herramientas de administración para superadmin"
                >
                  ⚙️ Panel de Administración
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Vista: lista de regiones (hoy o día anterior fijado)
  if (vista === "actual" || vista === "anterior") {
    const {
      totalGlobalDesabasto = 0,
      totalGlobalAtendidos = 0,
      totalGlobalEfectivos = 0,
      porcentajeGlobal = 0,
      porcentajeGlobalEfectividad = 0,
      semaforo = "🔴",
    } = resumenGlobal;

    // Si no hay datos cargados hoy, mostrar mensaje
    if (
      vista === "actual" &&
      !loading &&
      (regiones.length === 0 ||
        (totalGlobalDesabasto === 0 &&
          totalGlobalAtendidos === 0 &&
          totalGlobalEfectivos === 0))
    ) {
      return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-10">
          <div className="bg-white shadow-lg rounded-3xl p-8 text-center max-w-md w-full">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">
              Supervisión Global — Todas las Regiones
            </h2>
            <p className="text-sm text-gray-600 mb-6">
              Datos no han sido cargados para el día de hoy.
            </p>
            <button
              onClick={() => setVista("menu")}
              className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-lg font-semibold"
            >
              ⬅ Volver al Menú
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-8 text-center max-w-md w-full transform transition-all animate-fadeIn sm:mt-[-150px]">
          <div className="text-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              {semaforo}{" "}
              {vista === "anterior"
                ? `Desabasto Ultimo día atención — Todas las Regiones`
                : `Supervisor Global — Todas las Regiones`}
            </h2>
            <p className="text-sm text-gray-500">
              {vista === "anterior"
                ? formatFechaLargoCR(fechaFijadaCtx ?? isoNDiasAtras(1))
                : formatFechaLargoCR(hoyISO())}
            </p>
          </div>

          <div className="flex justify-center gap-3 mb-4">
            <button
              onClick={() => setVista("menu")}
              className="text-sm bg-gray-500 text-white py-1 px-4 rounded-lg hover:bg-gray-600"
            >
              ⬅ Menú
            </button>
            <button
              onClick={() =>
                cargarResumenGlobalGenerico(
                  vista === "anterior" ? 1 : 0,
                  vista === "anterior" ? (fechaFijadaCtx ?? null) : null
                )
              }
              className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
            >
              🔄 Actualizar
            </button>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div
              className={`${
                porcentajeGlobal === 100
                  ? "bg-green-600"
                  : porcentajeGlobal >= 80
                  ? "bg-yellow-400"
                  : porcentajeGlobal >= 50
                  ? "bg-orange-500"
                  : "bg-red-600"
              } h-4`}
              style={{ width: `${porcentajeGlobal}%` }}
            />
          </div>
          <p className="text-sm text-center text-gray-700 mb-1">
            Avance Global: {porcentajeGlobal}% — {totalGlobalAtendidos} de {totalGlobalDesabasto} PDV atendidos
          </p>
          <p className="text-xs text-center text-gray-600 mb-6">
            Efectividad Global: {porcentajeGlobalEfectividad}% — Efectivos {totalGlobalEfectivos} de {totalGlobalAtendidos}
          </p>

          {regiones.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow-sm text-center text-gray-600">
              No hay datos de regiones disponibles.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {regiones.map((r, i) => (
                <div key={i} className="rounded-xl shadow-md p-4 border border-gray-200 bg-white">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-1">
                    <span>{r.semaforo}</span> ZONA {r.region?.toUpperCase()}
                  </h3>

                  <div className="bg-gray-300 rounded-full h-3 overflow-hidden mb-2">
                    <div
                      className={`${
                        r.porcentajeAvance === 100
                          ? "bg-green-600"
                          : r.porcentajeAvance >= 80
                          ? "bg-yellow-400"
                          : r.porcentajeAvance >= 50
                          ? "bg-orange-500"
                          : "bg-red-600"
                      } h-3`}
                      style={{ width: `${r.porcentajeAvance}%` }}
                    />
                  </div>

                  <p className="text-xs text-gray-700">
                    Avance: {r.porcentajeAvance}% — {r.totalRegionAtendidos} de {r.totalRegionDesabasto}
                  </p>
                  <p className="text-xs text-gray-600 mb-2">
                    Efectividad: {r.porcentajeEfectividad}% — Efectivos {r.totalRegionEfectivos} de {r.totalRegionAtendidos}
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => cargarRegion(r.region, vista === "anterior" ? 1 : 0)}
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

  // Vista: agentes por región
  if (vista === "region" && regionSeleccionada) {
    const totalZonaDesabasto = agentesRegion.reduce((s, a) => s + (a.totalDesabasto || 0), 0);
    const totalZonaAtendidos = agentesRegion.reduce((s, a) => s + (a.totalAtendidos || 0), 0);
    const totalZonaEfectivos = agentesRegion.reduce((s, a) => s + (a.efectivos || 0), 0);

    const porcentajeZona =
      totalZonaDesabasto > 0 ? Math.round((totalZonaAtendidos / totalZonaDesabasto) * 100) : 0;
    const porcentajeZonaEfectividad =
      totalZonaAtendidos > 0 ? Math.round((totalZonaEfectivos / totalZonaAtendidos) * 100) : 0;

    let colorZona = "bg-red-600";
    if (porcentajeZona >= 80 && porcentajeZona < 100) colorZona = "bg-yellow-400";
    else if (porcentajeZona === 100) colorZona = "bg-green-600";
    else if (porcentajeZona >= 50) colorZona = "bg-orange-500";

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
          <div className="text-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              {obtenerSemaforo(porcentajeZona)} Supervisor — {regionSeleccionada.toUpperCase()}
            </h2>
            <p className="text-sm text-gray-500">
              {formatFechaLargoCR(fechaFijadaCtx ?? isoNDiasAtras(offsetDiasCtx))}
            </p>
          </div>

          <div className="flex justify-center gap-3 mb-4">
            <button
              onClick={() => {
                setRegionSeleccionada(null);
                setAgentesRegion([]);
                setVista(offsetDiasCtx === 1 ? "anterior" : "actual");
              }}
              className="text-sm bg-gray-500 text-white py-1 px-4 rounded-lg hover:bg-gray-600"
            >
              ⬅ Regiones
            </button>
            <button
              onClick={() => cargarRegion(regionSeleccionada, offsetDiasCtx)}
              className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
            >
              🔄 Actualizar
            </button>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div className={`${colorZona} h-4`} style={{ width: `${porcentajeZona}%` }} />
          </div>
          <p className="text-sm text-center text-gray-700">
            Avance: {totalZonaAtendidos} de {totalZonaDesabasto} ({porcentajeZona}%)
          </p>
          <p className="text-xs text-center text-gray-600 mb-4">
            Efectividad: {porcentajeZonaEfectividad}% — Efectivos {totalZonaEfectivos} de {totalZonaAtendidos}
          </p>

          {agentesRegion.length === 0 ? (
            <div className="bg-white p-6 rounded-xl shadow-sm text-center text-gray-600">
              No hay agentes en esta región.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {agentesRegion.map((a) => (
                <div key={a.id} className="rounded-xl shadow-md p-4 border border-gray-200 bg-white">
                  <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                    <span>{a.semaforo}</span> {a.nombre}
                  </h3>
                  <p className="text-xs text-gray-500 mb-1">Ruta {a.ruta_excel}</p>

                  <div className="bg-gray-300 rounded-full h-3 overflow-hidden mb-2">
                    <div
                      className={`${
                        a.porcentajeAvance === 100
                          ? "bg-green-600"
                          : a.porcentajeAvance >= 80
                          ? "bg-yellow-400"
                          : a.porcentajeAvance >= 50
                          ? "bg-orange-500"
                          : "bg-red-600"
                      } h-3`}
                      style={{ width: `${a.porcentajeAvance}%` }}
                    />
                  </div>

                  <p className="text-xs text-gray-700">
                    Avance: {a.totalAtendidos} de {a.totalDesabasto} ({a.porcentajeAvance}%)
                  </p>
                  <p className="text-xs text-gray-600 mb-2">
                    Efectividad: {a.porcentajeEfectividad}% — Efectivos {a.efectivos} de {a.totalAtendidos}
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

  // Vista: detalle del agente
  if (vista === "agente" && detallesAgente && agenteSeleccionado && regionSeleccionada) {
    const { pendientes, atenciones } = detallesAgente;
    const dias = Array.from({ length: 7 }, (_, i) => isoNDiasAtras(6 - i));
    const [inicio7d, fin7d] = [dias[0], dias[dias.length - 1]];

    const totalDesabasto = detallesAgente.totalDesabasto || 0;
    const totalAtendidos = detallesAgente.totalAtendidos || 0;
    const efectivos = detallesAgente.efectivos || 0;
    const noEfectivos = detallesAgente.noEfectivos || 0;
    const porcentajeAvance =
      totalDesabasto > 0 ? Math.round((totalAtendidos / totalDesabasto) * 100) : 0;
    const porcentajeEfectividad =
      totalAtendidos > 0 ? Math.round((efectivos / totalAtendidos) * 100) : 0;
    const porcentajeNoEfectivos =
      totalAtendidos > 0 ? Math.round((noEfectivos / totalAtendidos) * 100) : 0;

    const motivosMap = {};
    (atenciones || []).forEach((a) => {
      if (a.resultado === "no efectivo" && a.motivo_no_efectivo) {
        const m = a.motivo_no_efectivo.trim();
        motivosMap[m] = (motivosMap[m] || 0) + 1;
      }
    });
    const totalMotivos = Object.values(motivosMap).reduce((s, x) => s + x, 0);
    const motivosPorcentaje = Object.entries(motivosMap).map(([m, v]) => ({
      motivo: m,
      porcentaje: totalMotivos ? ((v / totalMotivos) * 100).toFixed(2) : "0.00",
      cantidad: v,
    }));

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
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
          <div className="text-center mb-3">
            <h2 className="text-lg font-semibold text-gray-800">
              📋 {regionSeleccionada.toUpperCase()} — {agenteSeleccionado.nombre}
            </h2>
            <p className="text-xs text-gray-500">
              📆 Datos desde {formatFechaLargoCR(inicio7d)} hasta {formatFechaLargoCR(fin7d)}
            </p>
          </div>
          <div className="flex justify-center gap-3 mb-4">
            <button
              onClick={() => {
                setDetallesAgente(null);
                setVista("region");
              }}
              className="text-sm bg-gray-500 text-white py-1 px-4 rounded-lg hover:bg-gray-600"
            >
              ⬅ Agentes
            </button>
            <button
              onClick={() => cargarDetalleAgente(agenteSeleccionado)}
              className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
            >
              🔄 Actualizar
            </button>
          </div>

          <div className="text-center mb-4">
            <p className="text-sm text-gray-700">
              Desabasto: {totalDesabasto} | Atendidos: {totalAtendidos}
            </p>
            <p className="text-xs text-gray-600">
              🟢 Efectivos {efectivos} ({porcentajeEfectividad}%) — 🔴 No efectivos {noEfectivos} (
              {porcentajeNoEfectivos}%) — Avance total {porcentajeAvance}%
            </p>
          </div>

          {pendientes.length === 0 ? (
            <p className="text-center text-gray-600 mt-2">Todos los PDV fueron atendidos ✅</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pendientes.map((pdv, i) => (
                <div key={i} className="rounded-xl shadow-md p-4 border border-gray-200 bg-white">
                  <h3 className="text-base font-bold text-gray-800">{pdv.pdv}</h3>
                  <p className="text-xs text-gray-500">MDN: {pdv.mdn_usuario}</p>
                  <p className="text-sm text-gray-700">Saldo: ₡{formatNumber(pdv.saldo)}</p>
                  <p className="text-sm text-gray-600">
                    Promedio semanal: {formatNumber(pdv.promedio_semanal)}
                  </p>
                  <p
                    className={`text-xs font-semibold mt-1 ${
                      pdv.porcentaje === 25
                        ? "text-red-600"
                        : pdv.porcentaje === 50
                        ? "text-orange-500"
                        : "text-yellow-500"
                    }`}
                  >
                    Desabasto: {pdv.porcentaje}%
                  </p>
                </div>
              ))}
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
                        {a.resultado === "efectivo" && <span className="w-3 h-3 bg-green-500 rounded-full" />}
                        {a.resultado === "no efectivo" && <span className="w-3 h-3 bg-red-500 rounded-full" />}
                      </p>
                      <p className="text-xs text-gray-500">MDN: {a.mdn_usuario}</p>
                      {a.resultado === "no efectivo" && a.motivo_no_efectivo && (
                        <p className="text-xs text-gray-600 italic">
                          Motivo: {a.motivo_no_efectivo}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-600">
                      {a.hora || formatHora(a)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-300 mt-3 pt-2 text-center text-sm text-gray-700">
                <p>
                  🟢 Efectivos: {efectivos} ({porcentajeEfectividad}%) — 🔴 No efectivos: {noEfectivos} (
                  {porcentajeNoEfectivos}%) — Avance: {porcentajeAvance}%
                </p>
              </div>
            </div>
          )}

          {motivosPorcentaje.length > 0 && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 shadow p-4 mt-6">
              <h4 className="text-md font-semibold text-gray-800 mb-2 text-center">
                🧾 Razones No Compra ({offsetDiasCtx === 1 ? "Ayer" : "Hoy"})
              </h4>
              <div className="flex flex-wrap justify-center gap-2">
                {motivosPorcentaje.map((m, i) => (
                  <span
                    key={i}
                    className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium"
                  >
                    {m.motivo}: {m.cantidad} ({m.porcentaje}%)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Vista: histórico global por región (últimos 7 días)
  if (vista === "historico") {
    const grupos = historico.reduce((acc, r) => {
      if (!acc[r.region]) acc[r.region] = [];
      acc[r.region].push(r);
      return acc;
    }, {});

    const regionesOrdenadas = Object.entries(grupos)
      .map(([region, registros]) => {
        const avgAvance = registros.reduce((s, r) => s + (r.porcentajeAvance || 0), 0) / registros.length;
        const avgEfectivos = registros.reduce((s, r) => s + (r.porcentajeEfectivos || 0), 0) / registros.length;
        return {
          region,
          registros,
          avgAvance: Math.round(avgAvance),
          avgEfectivos: Math.round(avgEfectivos),
        };
      })
      .sort((a, b) => b.avgAvance - a.avgAvance);

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center p-4 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl">
          <div className="flex flex-col items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800 text-center">📈 Resumen Histórico — Últimos 7 días</h2>
            {fechaRango.inicio && fechaRango.fin && (
              <p className="text-sm text-gray-600 mt-1 text-center">
                📆 Datos desde {formatFechaLargoCR(fechaRango.inicio)} hasta {formatFechaLargoCR(fechaRango.fin)}
              </p>
            )}
            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => setVista("menu")}
                className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
              >
                ⬅ Menú
              </button>
            </div>
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
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-gray-600">
                      Promedio Avance:{" "}
                      <span
                        className={
                          rg.avgAvance >= 100
                            ? "text-green-600 font-semibold"
                            : rg.avgAvance >= 80
                            ? "text-yellow-600 font-semibold"
                            : rg.avgAvance >= 50
                            ? "text-orange-600 font-semibold"
                            : "text-red-600 font-semibold"
                        }
                      >
                        {rg.avgAvance}%
                      </span>{" "}
                      | Efectivos: <span className="text-blue-600 font-semibold">{rg.avgEfectivos}%</span>
                    </p>
                    <button
                      onClick={() => cargarResumenHistoricoRegion(rg.region)}
                      className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg"
                    >
                      📊 Ver detalle por agentes
                    </button>
                  </div>
                </div>

                <div className="relative overflow-x-auto border rounded-lg shadow-sm">
                  <table className="min-w-[600px] w-full text-sm border-collapse">
                    <thead className="bg-gray-200 text-gray-800 sticky top-0 z-10">
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
                        <tr key={i} className="border-b hover:bg-gray-50 transition-colors">
                          <td className="p-2">{formatFechaCortoCR(r.fecha)}</td>
                          <td className="p-2 text-center">{r.desabasto}</td>
                          <td className="p-2 text-center">{r.atendidos}</td>
                          <td
                            className={`p-2 text-center font-semibold ${
                              r.porcentajeAvance >= 100
                                ? "text-green-600"
                                : r.porcentajeAvance >= 80
                                ? "text-yellow-600"
                                : r.porcentajeAvance >= 50
                                ? "text-orange-600"
                                : "text-red-600"
                            }`}
                          >
                            {r.porcentajeAvance}%
                          </td>
                          <td className="p-2 text-center text-blue-600 font-semibold">
                            {r.porcentajeEfectivos}%
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-100 font-semibold">
                        <td className="p-2 text-center">Promedio</td>
                        <td className="p-2 text-center">—</td>
                        <td className="p-2 text-center">—</td>
                        <td
                          className={`p-2 text-center ${
                            rg.avgAvance >= 100
                              ? "text-green-600"
                              : rg.avgAvance >= 80
                              ? "text-yellow-600"
                              : rg.avgAvance >= 50
                              ? "text-orange-600"
                              : "text-red-600"
                          }`}
                        >
                          {rg.avgAvance}%
                        </td>
                        <td className="p-2 text-center text-blue-600">{rg.avgEfectivos}%</td>
                      </tr>
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

  // Vista: histórico por agentes de una región (7 días)
  if (vista === "historicoRegionAgentes" && regionSeleccionada) {
    const grupos = historicoRegionAgentes.reduce((acc, r) => {
      if (!acc[r.agente]) acc[r.agente] = [];
      acc[r.agente].push(r);
      return acc;
    }, {});

    const agentesOrdenados = Object.entries(grupos)
      .map(([agente, registros]) => {
        const totalDesabasto = registros.reduce((s, r) => s + (r.desabasto || 0), 0);
        const totalAtendidos = registros.reduce((s, r) => s + (r.atendidos || 0), 0);
        const totalEfectivos = registros.reduce((s, r) => s + (r.efectivos || 0), 0);
        const totalNoEfectivos = totalAtendidos - totalEfectivos;

        const avgAvance = registros.reduce((s, r) => s + (r.porcentajeAvance || 0), 0) / registros.length;
        const avgEfectivos = registros.reduce((s, r) => s + (r.porcentajeEfectivos || 0), 0) / registros.length;
        const avgNoEfectivos = Math.max(0, 100 - avgEfectivos);

        return {
          agente,
          registros,
          avgAvance: Math.round(avgAvance),
          avgEfectivos: Math.round(avgEfectivos),
          avgNoEfectivos: Math.round(avgNoEfectivos),
          totalDesabasto,
          totalAtendidos,
          totalEfectivos,
          totalNoEfectivos,
        };
      })
      .sort((a, b) => b.avgEfectivos - a.avgEfectivos);

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center p-4 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl">
          <div className="flex flex-col items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800 text-center">
              📈 Resumen Histórico — Región {regionSeleccionada} — Últimos 7 días
            </h2>
            {fechaRangoRegion.inicio && fechaRangoRegion.fin && (
              <p className="text-sm text-gray-600 mt-1 text-center">
                📆 Datos desde {formatFechaLargoCR(fechaRangoRegion.inicio)} hasta{" "}
                {formatFechaLargoCR(fechaRangoRegion.fin)}
              </p>
            )}
            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => setVista("historico")}
                className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
              >
                ⬅ Volver a histórico global
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-center text-gray-500 mt-4">Cargando...</p>
          ) : agentesOrdenados.length === 0 ? (
            <p className="text-center text-gray-500 mt-4">No hay datos históricos para esta región.</p>
          ) : (
            agentesOrdenados.map((ag, idx) => (
              <div key={ag.agente} className="mb-6 border-t border-gray-300 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-bold text-gray-800">
                    {idx + 1}. 👤 {ag.agente}
                  </h3>
                  <p className="text-sm text-gray-600">
                    🟢 Efectivos {ag.avgEfectivos}% | 🔴 No efectivos {ag.avgNoEfectivos}%
                  </p>
                </div>

                <div className="relative overflow-x-auto border rounded-lg shadow-sm">
                  <table className="min-w-[760px] w-full text-sm border-collapse">
                    <thead className="bg-gray-200 text-gray-800 sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left">Fecha</th>
                        <th className="p-2 text-center">Desabasto</th>
                        <th className="p-2 text-center">Atendidos</th>
                        <th className="p-2 text-center">No efectivos</th>
                        <th className="p-2 text-center">% Avance</th>
                        <th className="p-2 text-center">% Efectivos</th>
                        <th className="p-2 text-center">% No efectivos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ag.registros.map((r, i) => {
                        const noEf = (r.atendidos || 0) - (r.efectivos || 0);
                        const pctNoEf = Math.max(0, 100 - (r.porcentajeEfectivos || 0));
                        return (
                          <tr key={i} className="border-b hover:bg-gray-50 transition-colors">
                            <td className="p-2">{formatFechaCortoCR(r.fecha)}</td>
                            <td className="p-2 text-center">{r.desabasto}</td>
                            <td className="p-2 text-center">{r.atendidos}</td>
                            <td className="p-2 text-center text-red-600 font-semibold">{noEf}</td>
                            <td
                              className={`p-2 text-center font-semibold ${
                                r.porcentajeAvance >= 100
                                  ? "text-green-600"
                                  : r.porcentajeAvance >= 80
                                  ? "text-yellow-600"
                                  : r.porcentajeAvance >= 50
                                  ? "text-orange-600"
                                  : "text-red-600"
                              }`}
                            >
                              {r.porcentajeAvance}%
                            </td>
                            <td className="p-2 text-center text-blue-600 font-semibold">
                              {r.porcentajeEfectivos}%
                            </td>
                            <td className="p-2 text-center text-red-600 font-semibold">
                              {pctNoEf}%
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-gray-100 font-semibold">
                        <td className="p-2 text-center">Totales</td>
                        <td className="p-2 text-center text-gray-800">{ag.totalDesabasto}</td>
                        <td className="p-2 text-center text-gray-800">{ag.totalAtendidos}</td>
                        <td className="p-2 text-center text-red-600">{ag.totalNoEfectivos}</td>
                        <td className="p-2 text-center text-gray-700">—</td>
                        <td className="p-2 text-center text-blue-600">{ag.avgEfectivos}%</td>
                        <td className="p-2 text-center text-red-600">{ag.avgNoEfectivos}%</td>
                      </tr>
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

  // NUEVO: vista resumenMotivos (por región, 7 días)
  if (vista === "resumenMotivos") {
    const totalEfectivosPais = resumenMotivos.reduce((s, r) => s + (r.efectivos || 0), 0);
    const totalNoEfectivosPais = resumenMotivos.reduce((s, r) => s + (r.noefectivos || 0), 0);
    const totalAtendidosPais = totalEfectivosPais + totalNoEfectivosPais;
    const pctEfectivosPais = totalAtendidosPais > 0 ? Math.round((totalEfectivosPais / totalAtendidosPais) * 100) : 0;
    const pctNoEfectivosPais = 100 - pctEfectivosPais;

    const motivosPaisCounts = {};
    resumenMotivos.forEach((r) => {
      (r.motitosPorcentaje || r.motivosPorcentaje || []).forEach((m) => {
        motivosPaisCounts[m.motivo] = (motivosPaisCounts[m.motivo] || 0) + (m.count || 0);
      });
    });
    const totalMotivosPais = Object.values(motivosPaisCounts).reduce((s, v) => s + v, 0);
    const motivosPaisArray = Object.entries(motivosPaisCounts)
      .map(([motivo, count]) => ({
        motivo,
        count,
        porcentaje: totalMotivosPais ? ((count / totalMotivosPais) * 100).toFixed(2) : "0.00",
      }))
      .sort((a, b) => b.count - a.count);

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center p-4 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-6xl animate-fadeIn">
          <div className="text-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              📊 Resumen Razones No Compra — Últimos 7 días
            </h2>
            {fechaRango.inicio && fechaRango.fin && (
              <p className="text-sm text-gray-600">
                📆 {formatFechaLargoCR(fechaRango.inicio)} → {formatFechaLargoCR(fechaRango.fin)}
              </p>
            )}
            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => setVista("menu")}
                className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
              >
                ⬅ Menú
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-md border border-gray-200 p-4 mb-6">
            <h3 className="text-md font-semibold text-gray-800 mb-1 text-center">🇨🇷 Total País</h3>
            <p className="text-sm text-gray-700 text-center">
              Atendidos {totalAtendidosPais.toLocaleString()} — 🟢 Efectivos {totalEfectivosPais.toLocaleString()} ({pctEfectivosPais}%) — 🔴 No efectivos {totalNoEfectivosPais.toLocaleString()} ({pctNoEfectivosPais}%)
            </p>
            {motivosPaisArray.length > 0 && (
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {motivosPaisArray.map((m, i) => (
                  <span
                    key={i}
                    className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium shadow-sm"
                  >
                    {m.motivo}: {m.count.toLocaleString()} ({m.porcentaje}%)
                  </span>
                ))}
              </div>
            )}
          </div>

          {resumenMotivos.length === 0 ? (
            <p className="text-center text-gray-500">No hay datos disponibles.</p>
          ) : (
            <>
              <div className="relative overflow-x-auto border rounded-lg shadow-sm">
                <table className="min-w-[800px] w-full text-sm border-collapse">
                  <thead className="bg-gray-200 text-gray-800">
                    <tr>
                      <th className="p-2 text-left">Región</th>
                      <th className="p-2 text-center">Desabasto</th>
                      <th className="p-2 text-center">Atendidos</th>
                      <th className="p-2 text-center">Efectivos</th>
                      <th className="p-2 text-center">No efectivos</th>
                      <th className="p-2 text-center">% Efectivos</th>
                      <th className="p-2 text-center">% No efectivos</th>
                      <th className="p-2 text-center">Ver agentes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumenMotivos.map((r, i) => (
                      <tr key={i} className="border-b hover:bg-gray-50">
                        <td className="p-2 font-semibold text-gray-800">{r.region}</td>
                        <td className="p-2 text-center">{r.desabasto}</td>
                        <td className="p-2 text-center">{r.atendidos}</td>
                        <td className="p-2 text-center text-green-600 font-semibold">{r.efectivos}</td>
                        <td className="p-2 text-center text-red-600 font-semibold">{r.noefectivos}</td>
                        <td className="p-2 text-center text-green-700 font-semibold">
                          {r.porcentajeEfectivos}%
                        </td>
                        <td className="p-2 text-center text-red-700 font-semibold">
                          {r.porcentajeNoEfectivos}%
                        </td>
                        <td className="p-2 text-center">
                          <button
                            onClick={() => cargarResumenMotivosRegion(r.region)}
                            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded-lg"
                          >
                            Detalle
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {resumenMotivos.map(
                (r, idx) =>
                  (r.motivosPorcentaje || []).length > 0 && (
                    <div
                      key={idx}
                      className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-6xl mx-auto mt-6 animate-fadeIn"
                    >
                      <div className="text-center mb-2">
                        <h4 className="text-lg font-semibold text-gray-800">
                          🧾 Razones No Compra — {r.region}
                        </h4>
                        {fechaRango.inicio && fechaRango.fin && (
                          <p className="text-sm text-gray-600">
                            📅 {formatFechaLargoCR(fechaRango.inicio)} → {formatFechaLargoCR(fechaRango.fin)}
                          </p>
                        )}
                      </div>

                      <p className="text-sm text-gray-700 text-center mb-3">
                        Atendidos {r.atendidos} — 🟢 Efectivos {r.efectivos} ({r.porcentajeEfectivos}%) — 🔴 No efectivos {r.noefectivos} ({r.porcentajeNoEfectivos}%)
                      </p>

                      <div className="flex flex-wrap justify-center gap-2">
                        {r.motivosPorcentaje.map((m, i) => (
                          <span
                            key={i}
                            className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium"
                          >
                            {m.motivo}: {m.count ?? 0} menciones ({m.porcentaje}%)
                          </span>
                        ))}
                      </div>
                    </div>
                  )
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // NUEVO: vista resumenMotivosRegion (detalle por agente, 7 días)
  if (vista === "resumenMotivosRegion" && regionSeleccionada) {
    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center p-4 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-6xl animate-fadeIn">
          <div className="text-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800 mb-1">
              📊 Razones No Compra — Región {regionSeleccionada}
            </h2>

            {fechaRango.inicio && fechaRango.fin && (
              <p className="text-sm text-gray-600 text-center">
                📅 {formatFechaLargoCR(fechaRango.inicio)} → {formatFechaLargoCR(fechaRango.fin)}
              </p>
            )}

            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => setVista("resumenMotivos")}
                className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
              >
                ⬅ Volver a Regiones
              </button>
            </div>
          </div>

          {resumenMotivosRegion.length === 0 ? (
            <p className="text-center text-gray-500">No hay datos para esta región.</p>
          ) : (
            resumenMotivosRegion.map((a, idx) => (
              <div key={idx} className="mb-8 border-t border-gray-300 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-bold text-gray-800">
                    {idx + 1}. 👤 {a.agente}
                  </h3>
                  <p className="text-sm text-gray-600">
                    🟢 Efectivos {a.porcentajeEfectivos}% | 🔴 No efectivos {a.porcentajeNoEfectivos}%
                  </p>
                </div>

                <div className="relative overflow-x-auto border rounded-lg shadow-sm mb-3">
                  <table className="min-w-[600px] w-full text-sm border-collapse">
                    <thead className="bg-gray-200 text-gray-800 sticky top-0 z-10">
                      <tr>
                        <th className="p-2 text-left">Desabasto</th>
                        <th className="p-2 text-center">Atendidos</th>
                        <th className="p-2 text-center">Efectivos</th>
                        <th className="p-2 text-center">No Efectivos</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b hover:bg-gray-50">
                        <td className="p-2 text-center font-semibold text-gray-800">{a.desabasto}</td>
                        <td className="p-2 text-center text-gray-700">{a.atendidos}</td>
                        <td className="p-2 text-center text-green-600 font-semibold">{a.efectivos}</td>
                        <td className="p-2 text-center text-red-600 font-semibold">{a.noefectivos}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                {a.motivosPorcentaje.length > 0 && (
                  <div className="bg-gray-50 rounded-xl border border-gray-200 shadow p-4">
                    <h4 className="text-md font-semibold text-gray-800 mb-2 text-center">
                      🧾 Resumen de Motivos de No Compra
                    </h4>
                    <div className="flex flex-wrap justify-center gap-2">
                      {a.motivosPorcentaje.map((m, i) => (
                        <span
                          key={i}
                          className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-sm font-medium"
                        >
                          {m.motivo}: {m.count ?? 0} ({m.porcentaje}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  /* ----------------------------- Fallback ----------------------------- */
  if (loading) {
    return <p className="text-center text-gray-500 mt-6">Cargando información...</p>;
  }
  return null;
}
