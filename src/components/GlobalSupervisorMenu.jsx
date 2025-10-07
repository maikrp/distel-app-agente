/* eslint-disable no-unused-vars */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export default function GlobalSupervisorMenu({ usuario }) {
  const [regiones, setRegiones] = useState([]);
  const [regionSeleccionada, setRegionSeleccionada] = useState(null);
  const [agentesRegion, setAgentesRegion] = useState([]);
  const [agenteSeleccionado, setAgenteSeleccionado] = useState(null);
  const [detallesAgente, setDetallesAgente] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resumenGlobal, setResumenGlobal] = useState({});

  const obtenerSemaforo = (porcentaje) => {
    if (porcentaje === 100) return "🟢";
    if (porcentaje >= 80) return "🟡";
    if (porcentaje >= 50) return "🟠";
    return "🔴";
  };

  const normalizarRegion = (r) => {
    const n = (r || "").trim().toLowerCase();
    if (!n) return null;
    if (n.includes("oficina")) return null;
    if (n === "gte" || n === "gte altura" || n === "gte bajura") return "GTE";
    if (n.includes("zona norte") || n === "norte") return "NORTE";
    if (n === "gam") return "GAM";
    return r.toUpperCase();
  };

  // === CARGAR RESUMEN GLOBAL ===
  const cargarResumenGlobal = useCallback(async () => {
    setLoading(true);
    const hoy = new Date().toISOString().split("T")[0];
    try {
      const { data: agentesDataRaw, error: agentesError } = await supabase
        .from("agentes")
        .select("*")
        .ilike("tipo", "%agente%")
        .eq("activo", true);

      if (agentesError) throw agentesError;

      const agentesData = (agentesDataRaw || [])
        .map((a) => ({
          ...a,
          region_norm: normalizarRegion(a.region),
        }))
        .filter((a) => a.region_norm && a.ruta_excel);

      const regionesMap = {};
      agentesData.forEach((a) => {
        if (!regionesMap[a.region_norm]) regionesMap[a.region_norm] = [];
        regionesMap[a.region_norm].push(a);
      });

      let totalGlobalDesabasto = 0;
      let totalGlobalAtendidos = 0;

      const regionesConDatos = await Promise.all(
        Object.keys(regionesMap).map(async (regionKey) => {
          const agentesRegion = regionesMap[regionKey];
          let totalRegionDesabasto = 0;
          let totalRegionAtendidos = 0;

          await Promise.all(
            agentesRegion.map(async (agente) => {
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
                .gte("fecha_carga", `${hoy}T00:00:00`)
                .lte("fecha_carga", `${hoy}T23:59:59`);

              const { data: atenciones } = await supabase
                .from("atenciones_agentes")
                .select("mdn_usuario")
                .eq("agente", agente.nombre)
                .eq("fecha", hoy);

              const totalDesabasto = registros?.length || 0;
              const totalAtendidos = atenciones?.length || 0;
              totalRegionDesabasto += totalDesabasto;
              totalRegionAtendidos += totalAtendidos;
            })
          );

          const porcentajeAvance =
            totalRegionDesabasto > 0
              ? Math.round((totalRegionAtendidos / totalRegionDesabasto) * 100)
              : 0;

          totalGlobalDesabasto += totalRegionDesabasto;
          totalGlobalAtendidos += totalRegionAtendidos;

          let colorBarra = "bg-red-600";
          if (porcentajeAvance >= 80 && porcentajeAvance < 100)
            colorBarra = "bg-yellow-400";
          else if (porcentajeAvance === 100) colorBarra = "bg-green-600";
          else if (porcentajeAvance >= 50) colorBarra = "bg-orange-500";

          return {
            region: regionKey,
            totalRegionDesabasto,
            totalRegionAtendidos,
            porcentajeAvance,
            colorBarra,
            semaforo: obtenerSemaforo(porcentajeAvance),
          };
        })
      );

      const porcentajeGlobal =
        totalGlobalDesabasto > 0
          ? Math.round((totalGlobalAtendidos / totalGlobalDesabasto) * 100)
          : 0;

      let colorGlobal = "bg-red-600";
      if (porcentajeGlobal >= 80 && porcentajeGlobal < 100)
        colorGlobal = "bg-yellow-400";
      else if (porcentajeGlobal === 100) colorGlobal = "bg-green-600";
      else if (porcentajeGlobal >= 50) colorGlobal = "bg-orange-500";

      setResumenGlobal({
        totalGlobalDesabasto,
        totalGlobalAtendidos,
        porcentajeGlobal,
        colorGlobal,
        semaforo: obtenerSemaforo(porcentajeGlobal),
      });

      setRegiones(
        regionesConDatos.sort((a, b) => b.porcentajeAvance - a.porcentajeAvance)
      );
    } catch (error) {
      console.error("Error al cargar resumen global:", error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // === CARGAR REGIÓN ===
  const cargarRegion = async (regionNorm) => {
    setLoading(true);
    setRegionSeleccionada(regionNorm);
    setAgenteSeleccionado(null);
    setDetallesAgente(null);
    const hoy = new Date().toISOString().split("T")[0];

    const { data: agentesDataRaw } = await supabase
      .from("agentes")
      .select("*")
      .ilike("tipo", "%agente%")
      .eq("activo", true);

    const agentesRegion = (agentesDataRaw || [])
      .map((a) => ({ ...a, region_norm: normalizarRegion(a.region) }))
      .filter((a) => a.region_norm === regionNorm && a.ruta_excel);

    const agentesConDatos = await Promise.all(
      agentesRegion.map(async (agente) => {
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
          .gte("fecha_carga", `${hoy}T00:00:00`)
          .lte("fecha_carga", `${hoy}T23:59:59`);

        const { data: atenciones } = await supabase
          .from("atenciones_agentes")
          .select("mdn_usuario")
          .eq("agente", agente.nombre)
          .eq("fecha", hoy);

        const totalDesabasto = registros?.length || 0;
        const totalAtendidos = atenciones?.length || 0;

        const porcentajeAvance =
          totalDesabasto > 0
            ? Math.round((totalAtendidos / totalDesabasto) * 100)
            : 0;

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

    setAgentesRegion(
      agentesConDatos.sort((a, b) => b.porcentajeAvance - a.porcentajeAvance)
    );
    setLoading(false);
  };

  // === CARGAR DETALLE DE AGENTE ===
  const cargarDetalleAgente = async (agente) => {
    setLoading(true);
    const hoy = new Date().toISOString().split("T")[0];

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
      .gte("fecha_carga", `${hoy}T00:00:00`)
      .lte("fecha_carga", `${hoy}T23:59:59`);

    const { data: atenciones } = await supabase
      .from("atenciones_agentes")
      .select("id, mdn_usuario, pdv, hora, created_at, resultado")
      .eq("agente", agente.nombre)
      .eq("fecha", hoy);

    const atendidosIds = (atenciones || []).map((a) => String(a.mdn_usuario));
    const pendientes = (registros || [])
      .filter((r) => !atendidosIds.includes(String(r.mdn_usuario)))
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
      totalDesabasto > 0 ? Math.round((totalAtendidos / totalDesabasto) * 100) : 0;

    let colorRuta = "bg-red-600";
    if (porcentajeAvance >= 80 && porcentajeAvance < 100) colorRuta = "bg-yellow-400";
    else if (porcentajeAvance === 100) colorRuta = "bg-green-600";
    else if (porcentajeAvance >= 50) colorRuta = "bg-orange-500";

    const efectivos = (atenciones || []).filter((a) => a.resultado === "efectivo").length;
    const noEfectivos = (atenciones || []).filter((a) => a.resultado === "no efectivo").length;
    const total = (atenciones || []).length || 1;
    const porcentajeEfectivos = Math.round((efectivos / total) * 100);
    const porcentajeNoEfectivos = Math.round((noEfectivos / total) * 100);

    setDetallesAgente({
      pendientes,
      atenciones,
      totalDesabasto,
      totalAtendidos,
      porcentajeAvance,
      colorRuta,
      semaforo: obtenerSemaforo(porcentajeAvance),
      efectivos,
      noEfectivos,
      porcentajeEfectivos,
      porcentajeNoEfectivos,
    });
    setAgenteSeleccionado(agente);
    setLoading(false);
  };

  useEffect(() => {
    cargarResumenGlobal();
  }, [cargarResumenGlobal]);

  // === PANTALLAS ===
  if (loading)
    return <p className="text-center text-gray-500 mt-6">Cargando información...</p>;

  // === Detalle del agente ===
  if (detallesAgente && agenteSeleccionado && regionSeleccionada) {
    const {
      pendientes,
      atenciones,
      totalDesabasto,
      totalAtendidos,
      porcentajeAvance,
      colorRuta,
      semaforo,
      efectivos,
      noEfectivos,
      porcentajeEfectivos,
      porcentajeNoEfectivos,
    } = detallesAgente;

    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-4xl animate-fadeIn">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-800">
              {semaforo} SUPERVISIÓN — {regionSeleccionada.toUpperCase()} — {agenteSeleccionado.nombre}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => setDetallesAgente(null)}
                className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
              >
                ⬅ Volver a agentes
              </button>
              <button
                onClick={() => cargarDetalleAgente(agenteSeleccionado)}
                className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
              >
                🔄 Actualizar
              </button>
            </div>
          </div>

          <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
            <div className={`${colorRuta} h-4`} style={{ width: `${porcentajeAvance}%` }} />
          </div>
          <p className="text-sm text-center text-gray-700 mb-4">
            {totalAtendidos} de {totalDesabasto} PDV atendidos ({porcentajeAvance}%)
          </p>

          {pendientes.length === 0 ? (
            <p className="text-center text-gray-600 mt-4">Todos los PDV fueron atendidos ✅</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pendientes.map((pdv, i) => (
                <div key={i} className="rounded-xl shadow-md p-4 border border-gray-200 bg-white">
                  <p className="text-xs text-gray-500">MDN: {pdv.mdn_usuario}</p>
                  <h3 className="text-base font-bold text-gray-800">{pdv.pdv}</h3>
                  <p className="text-sm text-gray-700 mb-1">Saldo: ₡{pdv.saldo?.toLocaleString("es-CR") || 0}</p>
                  <p className={`text-xs font-semibold ${
                    pdv.porcentaje === 25 ? "text-red-600" : pdv.porcentaje === 50 ? "text-orange-500" : "text-yellow-500"
                  }`}>
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
                <p className="text-green-600">🟢 Efectivos: {efectivos} ({porcentajeEfectivos}%)</p>
                <p className="text-red-600">🔴 No efectivos: {noEfectivos} ({porcentajeNoEfectivos}%)</p>
              </div>
            </div>
          )}

          {atenciones.length > 0 && (
            <div className="mt-6 bg-gray-50 rounded-xl border border-gray-200 shadow p-4">
              <h3 className="text-md font-semibold text-gray-800 text-center mb-2">
                PDV Atendidos Hoy ({atenciones.length})
              </h3>
              <div className="divide-y divide-gray-200">
                {atenciones.map((a) => (
                  <div key={a.id} className="py-2 text-sm text-gray-700 flex justify-between items-center">
                    <div>
                      <p className="font-semibold flex items-center gap-2">
                        {a.pdv}
                        {a.resultado === "efectivo" && <span className="w-3 h-3 bg-green-500 rounded-full" />}
                        {a.resultado === "no efectivo" && <span className="w-3 h-3 bg-red-500 rounded-full" />}
                      </p>
                      <p className="text-xs text-gray-500">MDN: {a.mdn_usuario}</p>
                    </div>
                    <span className="text-xs text-gray-600">{a.hora}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // === Vista de agentes por región ===
  if (regionSeleccionada && agentesRegion.length > 0) {
    const totalZonaDesabasto = agentesRegion.reduce((s, a) => s + a.totalDesabasto, 0);
    const totalZonaAtendidos = agentesRegion.reduce((s, a) => s + a.totalAtendidos, 0);
    const porcentajeZona =
      totalZonaDesabasto > 0 ? Math.round((totalZonaAtendidos / totalZonaDesabasto) * 100) : 0;

    let colorZona = "bg-red-600";
    if (porcentajeZona >= 80 && porcentajeZona < 100) colorZona = "bg-yellow-400";
    else if (porcentajeZona === 100) colorZona = "bg-green-600";
    else if (porcentajeZona >= 50) colorZona = "bg-orange-500";

    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-gray-800">
              {obtenerSemaforo(porcentajeZona)} SUPERVISIÓN GLOBAL — {regionSeleccionada.toUpperCase()}
            </h2>
            <div className="flex gap-2">
              <button
                onClick={() => { setRegionSeleccionada(null); setAgentesRegion([]); }}
                className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
              >
                ⬅ VOLVER A REGIONES
              </button>
              <button
                onClick={() => cargarRegion(regionSeleccionada)}
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
            {totalZonaAtendidos} de {totalZonaDesabasto} PDV atendidos ({porcentajeZona}%)
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {agentesRegion.map((a) => (
              <div key={a.id} className="rounded-xl shadow-md p-4 border border-gray-200 bg-white">
                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                  <span>{a.semaforo}</span> {a.nombre}
                </h3>
                <p className="text-xs text-gray-500 mb-1">Ruta {a.ruta_excel}</p>
                <div className="bg-gray-300 rounded-full h-3 overflow-hidden mb-2">
                  <div className={`${a.colorBarra} h-3`} style={{ width: `${a.porcentajeAvance}%` }} />
                </div>
                <p className="text-xs text-gray-700 mb-2">
                  {a.totalAtendidos} de {a.totalDesabasto} PDV atendidos ({a.porcentajeAvance}%)
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
        </div>
      </div>
    );
  }

  // === Vista global ===
  const { totalGlobalDesabasto, totalGlobalAtendidos, porcentajeGlobal, colorGlobal, semaforo } =
    resumenGlobal;

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            {semaforo} SUPERVISIÓN GLOBAL — TODAS LAS REGIONES
          </h2>
          <button
            onClick={cargarResumenGlobal}
            className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
          >
            🔄 Actualizar
          </button>
        </div>

        <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
          <div className={`${colorGlobal} h-4`} style={{ width: `${porcentajeGlobal}%` }} />
        </div>
        <p className="text-sm text-center text-gray-700 mb-6">
          Avance Global: {porcentajeGlobal}% — {totalGlobalAtendidos} de {totalGlobalDesabasto} PDV atendidos
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
                  <div className={`${r.colorBarra} h-3`} style={{ width: `${r.porcentajeAvance}%` }} />
                </div>
                <p className="text-xs text-gray-700 mb-2">
                  {r.totalRegionAtendidos} de {r.totalRegionDesabasto} PDV atendidos ({r.porcentajeAvance}%)
                </p>
                <button
                  onClick={() => cargarRegion(r.region)}
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
