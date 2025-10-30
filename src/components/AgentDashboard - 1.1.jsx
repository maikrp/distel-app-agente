import { useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

export default function AgentDashboard({ usuario }) {
  const [registros, setRegistros] = useState([]);
  const [atendidos, setAtendidos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actualizando, setActualizando] = useState(false);
  const [resumen, setResumen] = useState({});
  const [motivoSeleccionado, setMotivoSeleccionado] = useState(null);
  const [pdvSeleccionado, setPdvSeleccionado] = useState(null);
  const [mostrarMotivos, setMostrarMotivos] = useState(false);

  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });

  const cargarDatos = async () => {
    setLoading(true);
    setActualizando(true);

    // === Registros en desabasto ===
    const { data: registrosData } = await supabase
      .from("vw_desabasto_unicos")
      .select(
        "mdn_usuario, pdv, saldo, saldo_menor_al_promedio_diario, fecha_carga, jerarquias_n3_ruta, promedio_semanal, fecha_ultima_compra"
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
      .select(
        "id, mdn_usuario, pdv, resultado, motivo_no_efectivo, hora, created_at"
      )
      .eq("agente", usuario.nombre)
      .eq("fecha", hoy);

    const atendidosIds = (atencionesData || []).map((a) => String(a.mdn_usuario));

    // === Pendientes ===
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

    // === Último uso MR ===
    const mdns = (atencionesData || []).map((a) => a.mdn_usuario);
    let usos = [];
    if (mdns.length > 0) {
      const { data: usosData } = await supabase
        .from("desabasto_registros")
        .select("mdn_usuario, ultimo_uso_de_mis_recargas")
        .in("mdn_usuario", mdns);
      usos = usosData || [];
    }

    const atendidosConUso = (atencionesData || []).map((a) => {
      const match = usos.find((u) => u.mdn_usuario === a.mdn_usuario);
      return {
        ...a,
        ultimo_uso_de_mis_recargas: match
          ? match.ultimo_uso_de_mis_recargas
          : null,
      };
    });

    setRegistros(pendientes);
    setAtendidos(atendidosConUso);
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
    setActualizando(false);
  };

  const marcarAtencion = async (pdv, resultado, motivo = null) => {
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
        motivo_no_efectivo: motivo,
      },
    ]);
    setMostrarMotivos(false);
    setMotivoSeleccionado(null);
    setPdvSeleccionado(null);
    cargarDatos();
  };

  const manejarNoEfectivo = (pdv) => {
    setPdvSeleccionado(pdv);
    setMostrarMotivos(true);
  };

  const devolverPDV = async (atencion) => {
    await supabase.from("atenciones_agentes").delete().eq("id", atencion.id);
    cargarDatos();
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const formatNumber = (num) => {
    if (num === null || num === undefined || isNaN(num)) return "N/D";
    return parseFloat(num).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  if (loading)
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <p className="text-gray-500">Cargando información...</p>
      </div>
    );
  // === NUEVO: Si no hay datos cargados hoy, mostrar mensaje ===
  if (!loading && registros.length === 0 && atendidos.length === 0) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4 py-10">
        <div className="bg-white shadow-lg rounded-3xl p-8 text-center max-w-md w-full">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">
            Panel de Agente — Sin datos disponibles
          </h2>
          <p className="text-sm text-gray-600 mb-6">
            Datos no han sido cargados para el día de hoy.
          </p>
          <button
            onClick={cargarDatos}
            className="bg-blue-600 hover:bg-blue-700 text-white py-2 px-6 rounded-lg font-semibold"
          >
            🔄 Reintentar
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col min-h-screen bg-gray-100 overflow-y-auto">
      {/* === Encabezado fijo === */}
      <header className="sticky top-0 z-50 bg-white shadow-sm p-3 flex items-center justify-between max-w-4xl mx-auto w-full">
        <h2 className="text-sm sm:text-base md:text-lg font-semibold text-gray-800 flex-1 text-center">
          {usuario.region?.toUpperCase()} — {usuario.nombre}
        </h2>
        <button
          onClick={cargarDatos}
          className={`text-blue-600 hover:text-blue-800 text-lg transition-transform ${
            actualizando ? "animate-spin" : ""
          }`}
          title="Actualizar datos"
        >
          🔄
        </button>
      </header>

      {/* === Contenido principal === */}
      <main className="flex-1 w-full max-w-4xl mx-auto p-3 sm:p-5 md:p-8 space-y-5">
        {/* === Resumen de avance === */}
        <div className="bg-white rounded-2xl p-4 text-center shadow-md">
          <p className="text-sm md:text-base text-gray-700 mb-1">
            {resumen.totalAtendidos} / {resumen.totalDesabasto} PDV atendidos
          </p>
          <div className="w-full bg-gray-300 rounded-full h-3 overflow-hidden mb-1">
            <div
              className={`${
                resumen.porcentajeAvance >= 100
                  ? "bg-green-600"
                  : resumen.porcentajeAvance >= 80
                  ? "bg-yellow-400"
                  : resumen.porcentajeAvance >= 50
                  ? "bg-orange-500"
                  : "bg-red-600"
              } h-3 transition-all`}
              style={{ width: `${resumen.porcentajeAvance}%` }}
            />
          </div>
          <p className="text-xs md:text-sm text-gray-600">
            Avance: {resumen.porcentajeAvance}%
          </p>
        </div>

        {/* === PDV pendientes === */}
        <section>
          <h3 className="text-sm md:text-base font-semibold text-gray-700 mb-2 text-center">
            PDV por atender
          </h3>
          {registros.length === 0 ? (
            <p className="text-center text-gray-600 text-sm">
              Todos los PDV fueron atendidos ✅
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {registros.map((pdv, i) => (
                <div
                  key={i}
                  className="rounded-xl shadow p-4 bg-white border border-gray-200 hover:shadow-lg transition"
                >
                  <p className="text-xs text-gray-500">MDN: {pdv.mdn_usuario}</p>
                  <h3 className="text-base font-semibold text-gray-800">{pdv.pdv}</h3>
                  <p className="text-sm text-gray-700">
                    Saldo actual: ₡{formatNumber(pdv.saldo)}
                  </p>
                  <p className="text-sm text-gray-600">
                    Promedio semanal: ₡{formatNumber(pdv.promedio_semanal)}
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

                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => marcarAtencion(pdv, "efectivo")}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white text-xs sm:text-sm font-semibold py-2 rounded-lg"
                    >
                      🟢 Efectivo
                    </button>
                    <button
                      onClick={() => manejarNoEfectivo(pdv)}
                      className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm font-semibold py-2 rounded-lg"
                    >
                      🔴 No efectivo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* === Popup selección motivo === */}
        {mostrarMotivos && (
          <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
            <div className="bg-white rounded-2xl shadow-xl p-6 w-80">
              <h3 className="text-md font-semibold text-gray-800 mb-3 text-center">
                Seleccione el motivo
              </h3>
              <div className="flex flex-col gap-2">
                {[
                  "Tiene saldo suficiente",
                  "No tiene dinero",
                  "PDV Cerrado",
                  "No está encargado",
                  "PDV inactivo SIFAM",
                  "Se contacto sin respuesta",
                  "Recargado/Sin uso MR",
                  "Activador de chips",
                  "Usuario personal",
                  "Fuera Ruta/No SINPE",
                ].map((motivo, idx) => (
                  <button
                    key={idx}
                    onClick={() =>
                      marcarAtencion(pdvSeleccionado, "no efectivo", motivo)
                    }
                    className="bg-gray-100 hover:bg-gray-200 text-gray-800 py-2 px-3 rounded-lg text-sm font-medium"
                  >
                    {motivo}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setMostrarMotivos(false)}
                className="mt-4 text-sm text-gray-500 hover:text-gray-700 w-full text-center"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* === Resumen general === */}
        {atendidos.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-4 text-center">
            <h3 className="text-sm md:text-base font-semibold text-gray-800 mb-1">
              Resumen de resultados del día
            </h3>
            <div className="flex justify-around text-xs md:text-sm font-semibold">
              <p className="text-green-600">
                🟢 Efectivos: {resumen.efectivos} ({resumen.porcentajeEfectivos}%)
              </p>
              <p className="text-red-600">
                🔴 No efectivos: {resumen.noEfectivos} ({resumen.porcentajeNoEfectivos}%)
              </p>
            </div>
          </div>
        )}

        {/* === Histórico === */}
        {atendidos.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-md p-4">
            <h3 className="text-sm md:text-base font-semibold text-gray-800 text-center mb-2">
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
                    {a.resultado === "no efectivo" && a.motivo_no_efectivo && (
                      <p className="text-xs text-gray-600 italic">
                        Motivo: {a.motivo_no_efectivo}
                      </p>
                    )}
                    {a.ultimo_uso_de_mis_recargas && (
                      <p className="text-xs text-gray-500">
                        Último uso MR: {a.ultimo_uso_de_mis_recargas}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-600">
                      {a.hora ||
                        new Date(a.created_at).toLocaleTimeString("es-CR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                    </span>
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
      </main>
    </div>
  );
}
