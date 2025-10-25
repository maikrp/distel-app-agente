import React, { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Login({ onLogin }) {
  const [telefono, setTelefono] = useState("");
  const [agente, setAgente] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleBuscar = async () => {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("agentes")
      .select("nombre, telefono, tipo, ruta_normalizada, region, activo")
      .eq("telefono", telefono)
      .maybeSingle();

    setLoading(false);

    if (error) {
      console.error(error);
      setError("Error al consultar Supabase");
      return;
    }

    if (!data) {
      setError("Número no registrado");
      setAgente(null);
      return;
    }

    if (!data.activo) {
      setError("Usuario inactivo, contacte a su supervisor");
      setAgente(null);
      return;
    }

    setAgente(data);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden text-center">
        {/* Encabezado fijo */}
        <div className="bg-blue-700 p-5 text-white">
          <div className="flex flex-col items-center space-y-2">
            <img
             src={process.env.PUBLIC_URL + "/logo_distel.png"}
             alt="Distel"
             className="w-20 h-20 object-contain bg-white rounded-full p-2"
            />
            <h1 className="text-2xl font-bold tracking-wide">
              App Desabasto
            </h1>
            <p className="text-sm opacity-80">Control de PDV y Seguimiento</p>
            <img
              src={process.env.PUBLIC_URL + "/liberty.png"}
              alt="Liberty"
              className="w-20 h-20 mt-2 object-contain"
            />
            <p className="text-xs opacity-80">Distribuidor Autorizado Liberty</p>
          </div>
        </div>

        {/* Contenido dinámico */}
        <div className="p-6">
          {!agente ? (
            <>
              <h2 className="text-xl font-semibold text-gray-700 mb-2">
                Ingreso al sistema
              </h2>
              <p className="text-gray-500 mb-4">
                Digite su número de teléfono para continuar
              </p>
              <input
                type="tel"
                placeholder="Número de teléfono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                className="border border-gray-300 rounded-lg w-full p-2 text-center focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <button
                onClick={handleBuscar}
                disabled={loading || !telefono}
                className="mt-4 w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
              >
                {loading ? "Verificando..." : "Ingresar"}
              </button>
              {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}
            </>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-green-700 mb-2">
                Bienvenido
              </h2>
              <p className="text-lg font-bold">{agente.nombre}</p>
              <p className="text-gray-500">{agente.tipo}</p>
              <p className="text-sm text-blue-600">
                Ruta: {agente.ruta_normalizada || "No asignada"}
              </p>
              <p className="text-sm text-gray-600">
                Región: {agente.region || "Sin región"}
              </p>
              <button
                className="mt-5 w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700"
                onClick={() => onLogin(agente)}
              >
                Continuar al panel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
