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
    // Mediodía UTC para evitar saltos por DST
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

        const agentesConDatos = await Promise.all(
          (agentesData || []).map(async (agente) => {
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
              .select("mdn_usuario")
              .eq("agente", agente.nombre)
              .eq("fecha", fecha);

            const totalDesabasto = registros?.length || 0;
            const totalAtendidos = atenciones?.length || 0;

            const porcentajeAvance =
              totalDesabasto > 0
                ? Math.round((totalAtendidos / totalDesabasto) * 100)
                : 0;

            totalZonaDesabasto += totalDesabasto;
            totalZonaAtendidos += totalAtendidos;

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

        let colorZona = "bg-red-600";
        if (porcentajeZona >= 80 && porcentajeZona < 100)
          colorZona = "bg-yellow-400";
        else if (porcentajeZona === 100) colorZona = "bg-green-600";
        else if (porcentajeZona >= 50) colorZona = "bg-orange-500";

        setResumenZona({
          totalZonaDesabasto,
          totalZonaAtendidos,
          porcentajeZona,
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

  // ==== Resumen histórico últimos 7 días ====
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

      // Fechas: de hace 6 días a hoy, en CR
      const dias = Array.from({ length: 7 }, (_, i) => isoNDiasAtras(6 - i));
      const historicoData = [];

      for (const fecha of dias) {
        const inicio = `${fecha}T00:00:00`;
        const fin = `${fecha}T23:59:59`;

        // 1 consulta registros del día
        const { data: registrosDia } = await supabase
          .from("vw_desabasto_unicos")
          .select("jerarquias_n3_ruta, mdn_usuario, fecha_carga")
          .gte("fecha_carga", inicio)
          .lte("fecha_carga", fin);

        // 1 consulta atenciones del día
        const { data: atencionesDia } = await supabase
          .from("atenciones_agentes")
          .select("agente, resultado, mdn_usuario")
          .eq("fecha", fecha);

        // Construir métricas por agente
        (agentesData || []).forEach((ag) => {
          const desabastoAg =
            registrosDia?.filter((r) =>
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

  // ==== Detalles de una ruta/agente para día en curso o anterior ====
  const cargarDetalles = async (ruta, agenteNombre) => {
    setLoading(true);
    const fechaObjetivo = vista === "anterior" ? isoNDiasAtras(1) : hoyISO();

    const { data: registros } = await supabase
      .from("vw_desabasto_unicos")
      .select(
        "mdn_usuario, pdv, saldo, saldo_menor_al_promedio_diario, fecha_carga"
      )
      .ilike("jerarquias_n3_ruta", `%${ruta}%`)
      .in("saldo_menor_al_promedio_diario", [
        "Menor al 25%",
        "Menor al 50%",
        "Menor al 75%",
      ])
      .gte("fecha_carga", `${fechaObjetivo}T00:00:00`)
      .lte("fecha_carga", `${fechaObjetivo}T23:59:59`);

    const { data: atenciones } = await supabase
      .from("atenciones_agentes")
      .select(
        "id, mdn_usuario, pdv, hora, created_at, resultado, motivo_no_efectivo"
      )
      .eq("agente", agenteNombre)
      .eq("fecha", fechaObjetivo);

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
      totalDesabasto,
      totalAtendidos,
      porcentajeAvance,
      colorRuta,
      semaforo: obtenerSemaforo(porcentajeAvance),
      atenciones: atenciones || [],
      puntos: (registros || []).map((r) => {
        const t = (r.saldo_menor_al_promedio_diario || "").toLowerCase();
        let porcentaje = 100;
        if (t.includes("25")) porcentaje = 25;
        else if (t.includes("50")) porcentaje = 50;
        else if (t.includes("75")) porcentaje = 75;
        return { ...r, porcentaje };
      }),
    });

    setLoading(false);
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
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white shadow-lg rounded-3xl p-8 text-center max-w-md w-full">
          <h2 className="text-xl font-semibold mb-6 text-gray-800">
            Supervisión — {usuario.region}
          </h2>
          <div className="space-y-4">
            <button
              onClick={() => setVista("actual")}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-semibold"
            >
              📊 Seguimiento Desabasto (Hoy)
            </button>
            <button
              onClick={() => setVista("anterior")}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-2 px-4 rounded-lg font-semibold"
            >
              📅 Revisar Desabasto Día Anterior
            </button>
            <button
              onClick={() => setVista("historico")}
              className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg font-semibold"
            >
              📈 Ver Resumen de Avance por Agente (7 días)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==== Vista: histórico agrupado por agente con ranking y promedios ====
  if (vista === "historico") {
    // Agrupar por agente
    const grupos = historico.reduce((acc, r) => {
      if (!acc[r.agente]) acc[r.agente] = [];
      acc[r.agente].push(r);
      return acc;
    }, {});

    // Ranking por promedio de avance
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
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">
                📈 Resumen Histórico — Últimos 7 días
              </h2>
              {fechaRango.inicio && fechaRango.fin && (
                <p className="text-sm text-gray-600 mt-1">
                  📆 Datos desde {formatFechaLargoCR(fechaRango.inicio)} hasta{" "}
                  {formatFechaLargoCR(fechaRango.fin)}
                </p>
              )}
            </div>
            <button
              onClick={() => setVista("menu")}
              className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
            >
              ⬅ Volver al menú
            </button>
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

                {/* Contenedor con scroll y sombras dinámicas */}
                <div
                  className="relative overflow-x-auto border rounded-lg shadow-sm"
                  onScroll={(e) => {
                    const el = e.target;
                    const left = el.querySelector(".scroll-shadow-left");
                    const right = el.querySelector(".scroll-shadow-right");
                    if (!left || !right) return;
                    const atStart = el.scrollLeft <= 5;
                    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 5;
                    left.style.opacity = atStart ? "0" : "1";
                    right.style.opacity = atEnd ? "0" : "1";
                  }}
                >
                  {/* Sombras izquierda/derecha */}
                  <div
                    className="scroll-shadow-left absolute top-0 left-0 w-6 h-full bg-gradient-to-r from-gray-300/70 transition-opacity duration-300 pointer-events-none"
                    style={{ opacity: 0 }}
                  />
                  <div
                    className="scroll-shadow-right absolute top-0 right-0 w-6 h-full bg-gradient-to-l from-gray-300/70 transition-opacity duration-300 pointer-events-none"
                    style={{ opacity: 1 }}
                  />

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
      puntos = [],
      porcentajeAvance,
      colorRuta,
      totalDesabasto,
      totalAtendidos,
      atenciones = [],
      semaforo,
    } = detalles;

    const efectivos = atenciones.filter((a) => a.resultado === "efectivo").length;
    const noEfectivos = atenciones.filter((a) => a.resultado === "no efectivo").length;
    const total = atenciones.length || 1;
    const porcentajeEfectivos = Math.round((efectivos / total) * 100);
    const porcentajeNoEfectivos = Math.round((noEfectivos / total) * 100);

    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-4xl animate-fadeIn">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800">
              {semaforo} Avance de atención — {ruta}
            </h2>
            <button
              onClick={() => setDetalles(null)}
              className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
            >
              ⬅ Volver
            </button>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div
              className={`${colorRuta} h-4 transition-all duration-500`}
              style={{ width: `${porcentajeAvance}%` }}
            />
          </div>
          <p className="text-sm text-center text-gray-700 mb-4">
            {totalAtendidos} de {totalDesabasto} PDV en desabasto atendidos (
            {porcentajeAvance}%)
          </p>

          {puntos.length === 0 ? (
            <p className="text-center text-gray-600 mt-4">
              Todos los PDV en desabasto fueron atendidos ✅
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {puntos
                .sort((a, b) => a.porcentaje - b.porcentaje)
                .map((pdv, i) => (
                  <div
                    key={i}
                    className="rounded-xl shadow-md p-4 flex flex-col justify-between border border-gray-200 bg-white"
                  >
                    <div>
                      <p className="text-xs text-gray-500">
                        MDN: {pdv.mdn_usuario}
                      </p>
                      <h3 className="text-base font-bold text-gray-800">
                        {pdv.pdv}
                      </h3>
                      <p className="text-sm text-gray-700 mb-1">
                        Saldo actual: ₡{pdv.saldo?.toLocaleString("es-CR") || 0}
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
        </div>
      </div>
    );
  }

  // ==== Vista: seguimiento actual o día anterior (lista de agentes) ====
  const {
    totalZonaDesabasto = 0,
    totalZonaAtendidos = 0,
    porcentajeZona = 0,
    colorZona = "bg-red-600",
    semaforo = "🔴",
  } = resumenZona;

  if (loading)
    return (
      <p className="text-center text-gray-500 mt-6">Cargando información...</p>
    );

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-3">
            <span>{semaforo}</span>
            <span>
              {vista === "actual"
                ? `Supervisión — ${usuario.region}`
                : `Desabasto Día Anterior — ${usuario.region}`}
            </span>
            <span className="text-sm text-gray-500 font-normal">
              {vista === "anterior"
                ? formatFechaLargoCR(isoNDiasAtras(1))
                : formatFechaLargoCR(hoyISO())}
            </span>
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => setVista("menu")}
              className="text-sm bg-gray-500 text-white py-1 px-3 rounded-lg hover:bg-gray-600"
            >
              ⬅ Menú
            </button>
            <button
              onClick={() => cargarAgentesGenerico(vista === "actual" ? 0 : 1)}
              className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
            >
              🔄 Actualizar
            </button>
          </div>
        </div>

        <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
          <div
            className={`${colorZona} h-4 transition-all duration-500`}
            style={{ width: `${porcentajeZona}%` }}
          />
        </div>
        <p className="text-sm text-center text-gray-700 mb-4">
          {totalZonaAtendidos} de {totalZonaDesabasto} PDV en desabasto atendidos (
          {porcentajeZona}%)
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
                  {a.porcentajeAvance}%)
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
