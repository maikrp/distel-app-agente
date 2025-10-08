import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabaseClient";

export default function SupervisorMenu({ usuario }) {
  const [agentes, setAgentes] = useState([]);
  const [detalles, setDetalles] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resumenZona, setResumenZona] = useState({});

  const obtenerSemaforo = (porcentaje) => {
    if (porcentaje === 100) return "🟢";
    if (porcentaje >= 80) return "🟡";
    if (porcentaje >= 50) return "🟠";
    return "🔴";
  };

  const cargarAgentes = useCallback(async () => {
    setLoading(true);
    const hoy = new Date().toISOString().split("T")[0];

    try {
      // === Cargar agentes activos ===
      let query = supabase
        .from("agentes")
        .select("*")
        .ilike("tipo", "%agente%")
        .eq("activo", true); // <-- solo agentes activos

      if (usuario.acceso === "regional") {
        query = query
          .ilike("region", `%${usuario.region}%`)
          .eq("activo", true); // <-- filtro activo también aquí
      }

      const { data: agentesData, error: agentesError } = await query;
      if (agentesError) throw agentesError;

      let totalZonaDesabasto = 0;
      let totalZonaAtendidos = 0;

      const agentesConDatos = await Promise.all(
        agentesData.map(async (agente) => {
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
  }, [usuario]);

  const cargarDetalles = async (ruta, agenteNombre) => {
    setLoading(true);
    const hoy = new Date().toISOString().split("T")[0];

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
      .gte("fecha_carga", `${hoy}T00:00:00`)
      .lte("fecha_carga", `${hoy}T23:59:59`);

    const { data: atenciones } = await supabase
      .from("atenciones_agentes")
      .select("mdn_usuario, pdv, hora, created_at, resultado")
      .eq("agente", agenteNombre)
      .eq("fecha", hoy);

    const atendidosIds = (atenciones || []).map((a) =>
      String(a.mdn_usuario)
    );

    const pendientes = registros
      ?.filter((r) => !atendidosIds.includes(String(r.mdn_usuario)))
      .map((r) => {
        const t = (r.saldo_menor_al_promedio_diario || "").toLowerCase();
        let porcentaje = 100;
        if (t.includes("25")) porcentaje = 25;
        else if (t.includes("50")) porcentaje = 50;
        else if (t.includes("75")) porcentaje = 75;
        return { ...r, porcentaje };
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
      puntos: pendientes,
      porcentajeAvance,
      colorRuta,
      totalDesabasto,
      totalAtendidos,
      atenciones: atenciones || [],
      semaforo: obtenerSemaforo(porcentajeAvance),
    });

    setLoading(false);
  };

  useEffect(() => {
    cargarAgentes();
  }, [cargarAgentes]);

  if (loading)
    return <p className="text-center text-gray-500 mt-6">Cargando información...</p>;

  if (detalles) {
    const {
      ruta,
      puntos,
      porcentajeAvance,
      colorRuta,
      totalDesabasto,
      totalAtendidos,
      atenciones,
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
            {totalAtendidos} de {totalDesabasto} PDV en desabasto atendidos ({porcentajeAvance}%)
          </p>

          {puntos.length === 0 ? (
            <p className="text-center text-gray-600 mt-4">
              Todos los PDV en desabasto fueron atendidos ✅
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {puntos.map((pdv, i) => (
                <div
                  key={i}
                  className="rounded-xl shadow-md p-4 flex flex-col justify-between border border-gray-200 bg-white"
                >
                  <div>
                    <p className="text-xs text-gray-500">MDN: {pdv.mdn_usuario}</p>
                    <h3 className="text-base font-bold text-gray-800">{pdv.pdv}</h3>
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

          {atenciones.length > 0 && (
            <div className="mt-6 bg-gray-50 rounded-xl border border-gray-200 shadow p-4">
              <h3 className="text-md font-semibold text-gray-800 text-center mb-2">
                PDV Atendidos Hoy ({atenciones.length})
              </h3>
              <div className="divide-y divide-gray-200">
                {atenciones.map((a) => (
                  <div
                    key={a.mdn_usuario}
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

  const { totalZonaDesabasto, totalZonaAtendidos, porcentajeZona, colorZona, semaforo } =
    resumenZona;

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-5xl animate-fadeIn">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800">
            {semaforo} Supervisión — {usuario.region}
          </h2>
          <button
            onClick={cargarAgentes}
            className="text-sm bg-blue-600 text-white py-1 px-3 rounded-lg hover:bg-blue-700"
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
          {totalZonaAtendidos} de {totalZonaDesabasto} PDV en desabasto atendidos ({porcentajeZona}%)
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
