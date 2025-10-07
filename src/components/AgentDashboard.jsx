import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function AgentDashboard({ usuario }) {
  const [registros, setRegistros] = useState([]);
  const [atendidos, setAtendidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resumen, setResumen] = useState({});

  const hoy = new Date().toISOString().split("T")[0];

  const cargarDatos = async () => {
    setLoading(true);

    // === Registros en desabasto ===
    const { data: registrosData } = await supabase
      .from("vw_desabasto_unicos") // Vista única y más reciente
      .select(
        "mdn_usuario, pdv, saldo, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta"
      )
      .ilike("jerarquias_n3_ruta", `%${usuario.ruta_excel}%`)
      .in("saldo_menor_al_promedio_diario", [
        "Menor al 25%",
        "Menor al 50%",
        "Menor al 75%",
      ])
      .gte("fecha_carga", `${hoy}T00:00:00`)
      .lte("fecha_carga", `${hoy}T23:59:59`);

    // === Atenciones registradas ===
    const { data: atencionesData } = await supabase
      .from("atenciones_agentes")
      .select("id, mdn_usuario, pdv, resultado, hora, created_at")
      .eq("agente", usuario.nombre)
      .eq("fecha", hoy);

    const atendidosIds = (atencionesData || []).map((a) => String(a.mdn_usuario));

    // === Pendientes (no atendidos aún) ===
    const pendientes = (registrosData || [])
      .filter((r) => !atendidosIds.includes(String(r.mdn_usuario)))
      .map((r) => {
        const t = (r.saldo_menor_al_promedio_diario || "").toLowerCase();
        let porcentaje = 100;
        if (t.includes("25")) porcentaje = 25;
        else if (t.includes("50")) porcentaje = 50;
        else if (t.includes("75")) porcentaje = 75;
        return { ...r, porcentaje };
      })
      .sort((a, b) => a.porcentaje - b.porcentaje);

    // === Resumen ===
    const totalDesabasto = (registrosData || []).length;
    const totalAtendidos = (atencionesData || []).length;
    const porcentajeAvance = totalDesabasto
      ? Math.round((totalAtendidos / totalDesabasto) * 100)
      : 0;

    const efectivos = (atencionesData || []).filter(
      (a) => a.resultado === "efectivo"
    ).length;
    const noEfectivos = (atencionesData || []).filter(
      (a) => a.resultado === "no efectivo"
    ).length;
    const total = efectivos + noEfectivos || 1;
    const porcentajeEfectivos = Math.round((efectivos / total) * 100);
    const porcentajeNoEfectivos = Math.round((noEfectivos / total) * 100);

    setRegistros(pendientes);
    setAtendidos(atencionesData || []);
    setResumen({
      totalDesabasto,
      totalAtendidos,
      porcentajeAvance,
      efectivos,
      noEfectivos,
      porcentajeEfectivos,
      porcentajeNoEfectivos,
    });
    setLoading(false);
  };

  const marcarAtencion = async (pdv, resultado) => {
    await supabase.from("atenciones_agentes").insert([
      {
        agente: usuario.nombre,
        mdn_usuario: pdv.mdn_usuario,
        pdv: pdv.pdv,
        fecha: hoy,
        hora: new Date().toLocaleTimeString("es-CR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        resultado,
      },
    ]);
    cargarDatos();
  };

  // === NUEVA FUNCIÓN: devolver PDV a pendientes ===
  const devolverPDV = async (atencion) => {
    await supabase.from("atenciones_agentes").delete().eq("id", atencion.id);
    cargarDatos();
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  if (loading)
    return <p className="text-center text-gray-500 mt-6">Cargando información...</p>;

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-3xl p-6 w-full max-w-4xl animate-fadeIn">
        <h2 className="text-lg font-semibold text-gray-800 mb-4 text-center">
          Supervisión — {usuario.region?.toUpperCase()} — {usuario.nombre}
        </h2>

        <div className="bg-gray-300 rounded-full h-4 overflow-hidden mb-2">
          <div
            className={`${
              resumen.porcentajeAvance >= 100
                ? "bg-green-600"
                : resumen.porcentajeAvance >= 80
                ? "bg-yellow-400"
                : resumen.porcentajeAvance >= 50
                ? "bg-orange-500"
                : "bg-red-600"
            } h-4 transition-all duration-500`}
            style={{ width: `${resumen.porcentajeAvance}%` }}
          />
        </div>
        <p className="text-sm text-center text-gray-700 mb-4">
          {resumen.totalAtendidos} de {resumen.totalDesabasto} PDV en desabasto atendidos (
          {resumen.porcentajeAvance}%)
        </p>

        {/* === PDV pendientes === */}
        {registros.length === 0 ? (
          <p className="text-center text-gray-600 mt-4">
            Todos los PDV en desabasto fueron atendidos ✅
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {registros.map((pdv, i) => (
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
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => marcarAtencion(pdv, "efectivo")}
                    className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2 px-3 rounded-lg w-1/2"
                  >
                    🟢 Efectivo
                  </button>
                  <button
                    onClick={() => marcarAtencion(pdv, "no efectivo")}
                    className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 px-3 rounded-lg w-1/2"
                  >
                    🔴 No efectivo
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* === Resumen general === */}
        {atendidos.length > 0 && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 shadow p-4 mt-6 text-center">
            <h3 className="text-md font-semibold text-gray-800 mb-2">
              Resumen de resultados del día
            </h3>
            <div className="flex justify-around text-sm font-semibold">
              <p className="text-green-600">
                🟢 Efectivos: {resumen.efectivos} ({resumen.porcentajeEfectivos}%)
              </p>
              <p className="text-red-600">
                🔴 No efectivos: {resumen.noEfectivos} ({resumen.porcentajeNoEfectivos}%)
              </p>
            </div>
          </div>
        )}

        {/* === Histórico de atenciones del día === */}
        {atendidos.length > 0 && (
          <div className="mt-6 bg-gray-50 rounded-xl border border-gray-200 shadow p-4">
            <h3 className="text-md font-semibold text-gray-800 text-center mb-2">
              PDV Atendidos Hoy ({atendidos.length})
            </h3>
            <div className="divide-y divide-gray-200">
              {atendidos.map((a) => (
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
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">
                      {a.hora ||
                        new Date(a.created_at).toLocaleTimeString("es-CR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                    </span>

                    {/* NUEVO BOTÓN: devolver PDV a pendientes */}
                    <button
                      onClick={() => devolverPDV(a)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-bold"
                      title="Devolver a pendientes"
                    >
                      ↩
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
