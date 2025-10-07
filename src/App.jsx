import { useState } from "react";
import { supabase } from "./supabaseClient";
import AgentDashboard from "./components/AgentDashboard";
import SupervisorMenu from "./components/SupervisorMenu";
import GlobalSupervisorMenu from "./components/GlobalSupervisorMenu";

export default function App() {
  const [telefono, setTelefono] = useState("");
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(false);

  // === LOGIN ===
  const handleLogin = async () => {
    if (!telefono.trim()) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("agentes")
      .select("*")
      .eq("telefono", telefono)
      .single();

    if (error || !data) {
      alert("Acceso no autorizado");
      setUsuario(null);
    } else {
      setUsuario(data);
    }

    setLoading(false);
  };

  // === LOGOUT ===
  const handleLogout = () => {
    setUsuario(null);
    setTelefono("");
  };

  // === LOGIN SCREEN ===
  if (!usuario) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white shadow-lg rounded-3xl p-8 w-full max-w-sm border border-gray-200 text-center animate-fadeIn">
          {/* Logos centrados y proporcionados en línea */}
          <div className="flex items-center justify-center space-x-6 mb-6">
            <img
              src="/liberty.png"
              alt="Logo Liberty"
              className="w-24 h-24 object-contain"
            />
            <img
              src="/logo_distel.png"
              alt="Logo Distel"
              className="w-24 h-24 object-contain"
            />
          </div>

          <h1 className="text-2xl font-bold text-gray-800 mb-2">Bienvenido</h1>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            Control de Clientes en Desabasto
          </h2>
          <p className="text-gray-600 mb-6">Ingrese su número de teléfono</p>

          <input
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="Ejemplo: 60123456"
            className="border rounded-lg p-3 w-full text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            onClick={handleLogin}
            disabled={loading}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg w-full transition-all disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>

          <p className="text-xs text-gray-400 mt-6">
            © 2025 Distel — Sistema de Control de Desabasto
          </p>
        </div>
      </div>
    );
  }

  // === DASHBOARD ===
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="flex justify-between items-center p-4 bg-blue-700 text-white">
        <div>
          <h2 className="text-lg font-semibold">{usuario.nombre}</h2>
          <p className="text-sm">
            {usuario.tipo} —{" "}
            {usuario.acceso?.toLowerCase() === "global"
              ? "GLOBAL"
              : usuario.region?.toUpperCase()}
          </p>
          {usuario.ruta_excel && (
            <p className="text-xs text-blue-100">
              Ruta: {usuario.ruta_excel}
            </p>
          )}
        </div>

        <button
          onClick={handleLogout}
          className="bg-white text-blue-700 px-3 py-1 rounded-lg font-semibold"
        >
          Cerrar sesión
        </button>
      </div>

      <div className="p-4">
        {usuario.acceso === "ruta" && <AgentDashboard usuario={usuario} />}
        {usuario.acceso === "regional" && <SupervisorMenu usuario={usuario} />}
        {usuario.acceso === "global" && <GlobalSupervisorMenu usuario={usuario} />}
      </div>
    </div>
  );
}
