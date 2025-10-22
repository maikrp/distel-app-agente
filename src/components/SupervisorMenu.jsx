/* eslint-disable no-unused-vars */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export default function SupervisorMenu({ usuario }) {
  // Vistas: menu | actual | anterior | historico
  const [vista, setVista] = useState("menu");

  // Estado general
  const [agentes, setAgentes] = useState([]);
  const [detalles, setDetalles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resumenZona, setResumenZona] = useState({});

  // Histórico 7 días por agente (solo región del supervisor)
  const [historico, setHistorico] = useState([]);
  const [fechaRango, setFechaRango] = useState({ inicio: null, fin: null });

  // Zona horaria
  const TZ = "America/Costa_Rica";

  // ==== Helpers de fecha (sin desfases) ====
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
    const [y, m, d] = iso.split("-").map(Number);
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

  // ==== Semáforo ====
  const obtenerSemaforo = (p) => {
    if (p === 100) return "🟢";
    if (p >= 80) return "🟡";
    if (p >= 50) return "🟠";
    return "🔴";
  };

  // ==== Formato numérico con comas y 2 decimales ====
  const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) return "N/D";
    return parseFloat(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  // ==== Cargar agentes para hoy o día anterior ====
  const cargarAgentesGenerico = useCallback(
    async (offsetDias = 0) => {
      setLoading(true);
      try {
        const fecha = isoNDiasAtras(offsetDias);

        let query = supabase
          .from("agentes")
          .select("*")
          .ilike("tipo", "%agente%")
          .eq("activo", true);

        if (usuario.acceso === "regional") {
          query = query.ilike("region", `%${usuario.region}%`);
        }

        const { data: agentesData, error: agentesError } = await query;
        if (agentesError) throw agentesError;

        let totalZonaDesabasto = 0;
        let totalZonaAtendidos = 0;
        let totalZonaEfectivos = 0;

        const agentesConDatos = await Promise.all(
          (agentesData || []).map(async (agente) => {
            const fechaInicio = `${fecha}T00:00:00`;
            const fechaFin = `${fecha}T23:59:59`;

            const { data: registros } = await supabase
              .from("vw_desabasto_unicos")
              .select("mdn_usuario, jerarquias_n3_ruta")
              .ilike("jerarquias_n3_ruta", `%${agente.ruta_excel}%`)
              .in("saldo_menor_al_promedio_diario", [
                "Menor al 25%",
                "Menor al 50%",
                "Menor al 75%",
              ])
              .gte("fecha_carga", fechaInicio)
              .lte("fecha_carga", fechaFin);

            const { data: atenciones } = await supabase
              .from("atenciones_agentes")
              .select("mdn_usuario, resultado")
              .eq("agente", agente.nombre)
              .eq("fecha", fecha);

            const totalDesabasto = registros?.length || 0;
            const totalAtendidos = atenciones?.length || 0;
            const efectivosAgente = (atenciones || []).filter(
              (a) => a.resultado === "efectivo"
            ).length;

            const porcentajeAvance =
              totalDesabasto > 0
                ? Math.round((totalAtendidos / totalDesabasto) * 100)
                : 0;

            const porcentajeEfectivosAgente =
              totalAtendidos > 0
                ? Math.round((efectivosAgente / totalAtendidos) * 100)
                : 0;

            totalZonaDesabasto += totalDesabasto;
            totalZonaAtendidos += totalAtendidos;
            totalZonaEfectivos += efectivosAgente;

            let colorBarra = "bg-red-600";
            if (porcentajeAvance >= 80 && porcentajeAvance < 100)
              colorBarra = "bg-yellow-400";
            else if (porcentajeAvance === 100) colorBarra = "bg-green-600";
            else if (porcentajeAvance >= 50) colorBarra = "bg-orange-500";

            return {
              ...agente,
              totalDesabasto,
              totalAtendidos,
              porcentajeAvance,
              porcentajeEfectivosAgente,
              colorBarra,
              semaforo: obtenerSemaforo(porcentajeAvance),
            };
          })
        );

        const ordenados = agentesConDatos
          .sort((a, b) => b.porcentajeAvance - a.porcentajeAvance)
          .map((a, index) => ({
            ...a,
            ranking: index + 1,
            totalAgentes: agentesConDatos.length,
          }));

        const porcentajeZona =
          totalZonaDesabasto > 0
            ? Math.round((totalZonaAtendidos / totalZonaDesabasto) * 100)
            : 0;

        const porcentajeEfectivosZona =
          totalZonaAtendidos > 0
            ? Math.round((totalZonaEfectivos / totalZonaAtendidos) * 100)
            : 0;

        let colorZona = "bg-red-600";
        if (porcentajeZona >= 80 && porcentajeZona < 100)
          colorZona = "bg-yellow-400";
        else if (porcentajeZona === 100) colorZona = "bg-green-600";
        else if (porcentajeZona >= 50) colorZona = "bg-orange-500";

        setResumenZona({
          totalZonaDesabasto,
          totalZonaAtendidos,
          porcentajeZona,
          porcentajeEfectivosZona,
          colorZona,
          semaforo: obtenerSemaforo(porcentajeZona),
        });

        setAgentes(ordenados);
      } catch (error) {
        console.error("Error al cargar agentes:", error.message);
      } finally {
        setLoading(false);
      }
    },
    [usuario]
  );

  // ==== Resumen histórico últimos 7 días por agente (solo región del supervisor) ====
  const cargarResumenHistorico = useCallback(async () => {
    setLoading(true);
    try {
      let queryAgentes = supabase
        .from("agentes")
        .select("nombre, ruta_excel, region")
        .ilike("tipo", "%agente%")
        .eq("activo", true);

      if (usuario.acceso === "regional") {
        queryAgentes = queryAgentes.ilike("region", `%${usuario.region}%`);
      }

      const { data: agentesData } = await queryAgentes;
      if (!agentesData || agentesData.length === 0) {
        setHistorico([]);
        setFechaRango({ inicio: null, fin: null });
        setLoading(false);
        return;
      }

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
          .select("agente, resultado, mdn_usuario")
          .eq("fecha", fecha);

        (agentesData || []).forEach((ag) => {
          const desabastoAg =
            (registrosDia || []).filter((r) =>
              r.jerarquias_n3_ruta?.includes(ag.ruta_excel)
            ).length || 0;

          const atencionesAg = (atencionesDia || []).filter(
            (a) => a.agente === ag.nombre
          );
          const totalAtendidos = atencionesAg.length;
          const efectivos = atencionesAg.filter(
            (a) => a.resultado === "efectivo"
          ).length;

          const porcentajeAvance =
            desabastoAg > 0
              ? Math.round((totalAtendidos / desabastoAg) * 100)
              : 0;

          const porcentajeEfectivos =
            totalAtendidos > 0
              ? Math.round((efectivos / totalAtendidos) * 100)
              : 0;

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

      const filtrados = historicoData.filter(
        (r) => r.desabasto > 0 || r.atendidos > 0
      );

      setHistorico(filtrados);
      setFechaRango({ inicio: dias[0], fin: dias[dias.length - 1] });
    } catch (err) {
      console.error("Error al cargar histórico:", err.message);
      setHistorico([]);
      setFechaRango({ inicio: null, fin: null });
    } finally {
      setLoading(false);
    }
  }, [usuario]);

  // ==== Detalles de una ruta/agente para día en curso o anterior (filtra atendidos) ====
  const cargarDetalles = async (ruta, agenteNombre) => {
    setLoading(true);
    const fechaObjetivo = vista === "anterior" ? isoNDiasAtras(1) : hoyISO();
    const inicio = `${fechaObjetivo}T00:00:00`;
    const fin = `${fechaObjetivo}T23:59:59`;

    const { data: registros } = await supabase
      .from("vw_desabasto_unicos")
      .select(
        // Nuevos campos incluidos
        "mdn_usuario, pdv, saldo, promedio_semanal, fecha_ultima_compra, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta"
      )
      .ilike("jerarquias_n3_ruta", `%${ruta}%`)
      .in("saldo_menor_al_promedio_diario", [
        "Menor al 25%",
        "Menor al 50%",
        "Menor al 75%",
      ])
      .gte("fecha_carga", inicio)
      .lte("fecha_carga", fin);

    const { data: atenciones } = await supabase
      .from("atenciones_agentes")
      .select(
        "id, mdn_usuario, pdv, hora, created_at, resultado, motivo_no_efectivo"
      )
      .eq("agente", agenteNombre)
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
    const porcentajeAvance =
      totalDesabasto > 0
        ? Math.round((totalAtendidos / totalDesabasto) * 100)
        : 0;

    let colorRuta = "bg-red-600";
    if (porcentajeAvance >= 80 && porcentajeAvance < 100)
      colorRuta = "bg-yellow-400";
    else if (porcentajeAvance === 100) colorRuta = "bg-green-600";
    else if (porcentajeAvance >= 50) colorRuta = "bg-orange-500";

    setDetalles({
      ruta,
      agenteNombre,
      fechaObjetivo,
      totalDesabasto,
      totalAtendidos,
      porcentajeAvance,
      colorRuta,
      semaforo: obtenerSemaforo(porcentajeAvance),
      atenciones: atenciones || [],
      pendientes,
    });

    setLoading(false);
  };

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

  // ==== Cargas por vista ====
  useEffect(() => {
    if (vista === "menu") {
      setLoading(false);
      return;
    }
    if (vista === "actual") cargarAgentesGenerico(0);
    if (vista === "anterior") cargarAgentesGenerico(1);
    if (vista === "historico") cargarResumenHistorico();
  }, [vista, cargarAgentesGenerico, cargarResumenHistorico]);

  // ==== Vista: menú principal ====
  if (vista === "menu") {
    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="flex flex-col justify-center items-center w-full px-4">
          <div className="bg-white shadow-lg rounded-3xl p-8 text-center max-w-md w-full transform transition-all animate-fadeIn">
            <h2 className="text-xl font-semibold mb-6 text-gray-800">
              Supervisión — {usuario.region}
            </h2>
            <div className="space-y-4">
              <button
                onClick={() => setVista("actual")}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📊 Seguimiento Desabasto (Hoy)
              </button>
              <button
                onClick={() => setVista("anterior")}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📅 Revisar Desabasto Día Anterior
              </button>
              <button
                onClick={() => setVista("historico")}
                className="w-full bg-green-600 hover:bg-green-700 text-white py-3 px-4 rounded-lg font-semibold"
              >
                📈 Ver Resumen de Avance por Agente (7 días)
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==== Vista: histórico agrupado por agente con ranking y promedios (7 días) ====
  if (vista === "historico") {
    const grupos = historico.reduce((acc, r) => {
      if (!acc[r.agente]) acc[r.agente] = [];
      acc[r.agente].push(r);
      return acc;
    }, {});

    const agentesOrdenados = Object.entries(grupos)
      .map(([agente, registros]) => {
        const avgAvance =
          registros.reduce((s, r) => s + (r.porcentajeAvance || 0), 0) /
          registros.length;
        const avgEfectivos =
          registros.reduce((s, r) => s + (r.porcentajeEfectivos || 0), 0) /
          registros.length;
        return {
          agente,
          registros,
          avgAvance: Math.round(avgAvance),
          avgEfectivos: Math.round(avgEfectivos),
        };
      })
      .sort((a, b) => b.avgAvance - a.avgAvance);

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl">
          <div className="flex flex-col items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800 text-center">
              📈 Resumen Histórico — Últimos 7 días — Región {usuario.region}
            </h2>
            {fechaRango.inicio && fechaRango.fin && (
              <p className="text-sm text-gray-600 mt-1 text-center">
                📆 Datos desde {formatFechaLargoCR(fechaRango.inicio)} hasta{" "}
                {formatFechaLargoCR(fechaRango.fin)}
              </p>
            )}
            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => setVista("menu")}
                className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
              >
                ⬅ Volver al menú
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-center text-gray-500 mt-4">Cargando...</p>
          ) : agentesOrdenados.length === 0 ? (
            <p className="text-center text-gray-500 mt-4">
              No hay datos históricos disponibles.
            </p>
          ) : (
            agentesOrdenados.map((ag, idx) => (
              <div key={ag.agente} className="mb-6 border-t border-gray-300 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-md font-bold text-gray-800">
                    {idx + 1}. 👤 {ag.agente}
                  </h3>
                  <p className="text-sm text-gray-600">
                    Promedio Avance:{" "}
                    <span
                      className={
                        ag.avgAvance >= 100
                          ? "text-green-600 font-semibold"
                          : ag.avgAvance >= 80
                          ? "text-yellow-600 font-semibold"
                          : ag.avgAvance >= 50
                          ? "text-orange-600 font-semibold"
                          : "text-red-600 font-semibold"
                      }
                    >
                      {ag.avgAvance}%
                    </span>{" "}
                    | Efectivos:{" "}
                    <span className="text-blue-600 font-semibold">
                      {ag.avgEfectivos}%
                    </span>
                  </p>
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
                      {ag.registros.map((r, i) => (
                        <tr
                          key={i}
                          className="border-b hover:bg-gray-50 transition-colors"
                        >
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
                            ag.avgAvance >= 100
                              ? "text-green-600"
                              : ag.avgAvance >= 80
                              ? "text-yellow-600"
                              : ag.avgAvance >= 50
                              ? "text-orange-600"
                              : "text-red-600"
                          }`}
                        >
                          {ag.avgAvance}%
                        </td>
                        <td className="p-2 text-center text-blue-600">
                          {ag.avgEfectivos}%
                        </td>
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

  // ==== Vista: detalles de una ruta ====
  if (detalles) {
    const {
      ruta,
      pendientes = [],
      porcentajeAvance,
      colorRuta,
      totalDesabasto,
      totalAtendidos,
      atenciones = [],
      semaforo,
      fechaObjetivo,
    } = detalles;

    const efectivos = atenciones.filter((a) => a.resultado === "efectivo").length;
    const noEfectivos = atenciones.filter((a) => a.resultado === "no efectivo").length;
    const total = atenciones.length || 1;
    const porcentajeEfectivos = Math.round((efectivos / total) * 100);
    const porcentajeNoEfectivos = Math.round((noEfectivos / total) * 100);

    return (
      <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-4xl animate-fadeIn">
          <div className="flex flex-col items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800 text-center">
              {semaforo} Avance de atención — {ruta}
            </h2>
            <p className="text-xs text-gray-500">
              Fecha: {formatFechaLargoCR(fechaObjetivo)}
            </p>
            <div className="flex justify-center gap-3 mt-3">
              <button
                onClick={() => setDetalles(null)}
                className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
              >
                ⬅ Volver
              </button>
            </div>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div
              className={`${colorRuta} h-4 transition-all duration-500`}
              style={{ width: `${porcentajeAvance}%` }}
            />
          </div>
          <p className="text-sm text-center text-gray-700 mb-4">
            {totalAtendidos} de {totalDesabasto} PDV en desabasto atendidos ({porcentajeAvance}%) |{" "}
            Efectivos: {porcentajeEfectivos}%
          </p>

          {pendientes.length === 0 ? (
            <p className="text-center text-gray-600 mt-4">
              Todos los PDV en desabasto fueron atendidos ✅
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pendientes.map((pdv, i) => (
                <div
                  key={i}
                  className="rounded-xl shadow-md p-4 flex flex-col justify-between border border-gray-200 bg-white"
                >
                  <div>
                    <p className="text-xs text-gray-500">MDN: {pdv.mdn_usuario}</p>
                    <h3 className="text-base font-bold text-gray-800">{pdv.pdv}</h3>
                    <p className="text-sm text-gray-700">
                      Saldo actual: ₡{formatNumber(pdv.saldo)}
                    </p>
                    <p className="text-sm text-gray-600">
                      Promedio semanal: {formatNumber(pdv.promedio_semanal)}
                    </p>
                    <p className="text-sm text-gray-600">
                      Última compra:{" "}
                      {pdv.fecha_ultima_compra
                        ? new Date(pdv.fecha_ultima_compra).toLocaleDateString("es-CR")
                        : "N/D"}
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
                      Desabasto: {pdv.porcentaje} %
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {atenciones.length > 0 && (
            <div className="bg-gray-50 rounded-xl border border-gray-200 shadow p-4 mt-6 text-center">
              <h3 className="text-md font-semibold text-gray-800 mb-2">
                Resumen de resultados del día
              </h3>
              <div className="flex justify-around text-sm font-semibold">
                <p className="text-green-600">
                  🟢 Efectivos: {efectivos} ({porcentajeEfectivos}%)
                </p>
                <p className="text-red-600">
                  🔴 No efectivos: {noEfectivos} ({porcentajeNoEfectivos}%)
                </p>
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
                    <span className="text-xs text-gray-600">
                      {formatHora(a)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ==== Vista: seguimiento actual o día anterior (lista de agentes) ====
  const {
    totalZonaDesabasto = 0,
    totalZonaAtendidos = 0,
    porcentajeZona = 0,
    porcentajeEfectivosZona = 0,
    colorZona = "bg-red-600",
    semaforo = "🔴",
  } = resumenZona;

  if (loading)
    return (
      <p className="text-center text-gray-500 mt-6">Cargando información...</p>
    );

  return (
    <div className="min-h-screen sm:min-h-[90vh] bg-gray-100 flex items-start sm:items-center justify-center px-4 py-6 sm:py-10 overflow-hidden">
      <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
        <h2 className="text-xl font-semibold text-gray-800 text-center">
          {semaforo}{" "}
          {vista === "actual"
            ? `Supervisión — ${usuario.region}`
            : `Desabasto Día Anterior — ${usuario.region}`}
        </h2>
        <p className="text-sm text-gray-500 text-center mb-3">
          {vista === "anterior"
            ? formatFechaLargoCR(isoNDiasAtras(1))
            : formatFechaLargoCR(hoyISO())}
        </p>

        {/* Botones centrados debajo del título */}
        <div className="flex justify-center gap-3 mb-4">
          <button
            onClick={() => setVista("menu")}
            className="text-sm bg-gray-500 text-white py-1 px-4 rounded-lg hover:bg-gray-600"
          >
            ⬅ Menú
          </button>
          <button
            onClick={() => cargarAgentesGenerico(vista === "actual" ? 0 : 1)}
            className="text-sm bg-blue-600 text-white py-1 px-4 rounded-lg hover:bg-blue-700"
          >
            🔄 Actualizar
          </button>
        </div>

        <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
          <div
            className={`${colorZona} h-4 transition-all duration-500`}
            style={{ width: `${porcentajeZona}%` }}
          />
        </div>
        <p className="text-sm text-center text-gray-700 mb-4">
          {totalZonaAtendidos} de {totalZonaDesabasto} PDV en desabasto atendidos (
          {porcentajeZona}%) | Efectivos: {porcentajeEfectivosZona}%
        </p>

        {agentes.length === 0 ? (
          <div className="bg-white p-6 rounded-xl shadow-sm text-center text-gray-600">
            No hay agentes registrados en esta región.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {agentes.map((a) => (
              <div
                key={a.id}
                className="rounded-xl shadow-md p-4 border border-gray-200 bg-white"
              >
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span>{a.semaforo}</span> {a.nombre}
                </h3>
                <p className="text-xs text-gray-500 mb-1">
                  {a.ranking}.º de {a.totalAgentes} — Ruta {a.ruta_excel}
                </p>

                <div className="bg-gray-300 rounded-full h-3 overflow-hidden mb-2">
                  <div
                    className={`${a.colorBarra} h-3 transition-all duration-500`}
                    style={{ width: `${a.porcentajeAvance}%` }}
                  />
                </div>
                <p className="text-xs text-gray-700 mb-2">
                  {a.totalAtendidos} de {a.totalDesabasto} PDV en desabasto atendidos (
                  {a.porcentajeAvance}%) | Efectivos: {a.porcentajeEfectivosAgente}%
                </p>

                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 px-4 rounded-lg w-full"
                  onClick={() => cargarDetalles(a.ruta_excel, a.nombre)}
                >
                  🔍 Ver detalles
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
