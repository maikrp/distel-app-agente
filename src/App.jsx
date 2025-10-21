import { useState, useEffect } from "react";
import bcrypt from "bcryptjs";
import { supabase } from "./supabaseClient";
import AgentDashboard from "./components/AgentDashboard";
import SupervisorMenu from "./components/SupervisorMenu";
import GlobalSupervisorMenu from "./components/GlobalSupervisorMenu";

export default function App() {
  const [telefono, setTelefono] = useState("");
  const [clave, setClave] = useState("");
  const [nuevaClave, setNuevaClave] = useState("");
  const [confirmarClave, setConfirmarClave] = useState("");
  // === CAMBIO: persistencia de sesión ===
  const [usuario, setUsuario] = useState(() => {
    const stored = localStorage.getItem("usuario");
    return stored ? JSON.parse(stored) : null;
  });
  const [loading, setLoading] = useState(false);
  const [requiereCambio, setRequiereCambio] = useState(false);

  // === LOGIN ===
  const handleLogin = async () => {
    const tel = telefono.trim();
    const pass = clave.trim();
    if (!tel || !pass) {
      alert("Debe ingresar número y clave.");
      return;
    }

    setLoading(true);

    const { data: agente, error } = await supabase
      .from("agentes")
      .select("*")
      .eq("telefono", tel)
      .eq("activo", true)
      .single();

    if (error || !agente) {
      alert("Usuario no encontrado o inactivo.");
      setLoading(false);
      return;
    }

    const coincide = await bcrypt.compare(pass, agente.clave);
    if (!coincide) {
      alert("Clave incorrecta.");
      setLoading(false);
      return;
    }

    if (agente.clave_temporal) {
      setUsuario(agente);
      localStorage.setItem("usuario", JSON.stringify(agente)); // 🔹 persistir
      setRequiereCambio(true);
      setLoading(false);
      return;
    }

    setUsuario(agente);
    localStorage.setItem("usuario", JSON.stringify(agente)); // 🔹 persistir
    setLoading(false);
  };

  // === CAMBIAR CLAVE TEMPORAL ===
  const handleCambioClave = async () => {
    if (!nuevaClave || nuevaClave.length < 4) {
      alert("La nueva clave debe tener al menos 4 dígitos.");
      return;
    }
    if (nuevaClave !== confirmarClave) {
      alert("Las claves no coinciden.");
      return;
    }

    setLoading(true);
    const nuevaHash = await bcrypt.hash(nuevaClave, 12);

    const { error } = await supabase
      .from("agentes")
      .update({
        clave: nuevaHash,
        clave_temporal: false,
      })
      .eq("telefono", usuario.telefono);

    if (error) {
      alert("Error al actualizar la clave.");
      setLoading(false);
      return;
    }

    alert("Clave actualizada correctamente. Puede continuar.");
    const actualizado = { ...usuario, clave_temporal: false };
    setUsuario(actualizado);
    localStorage.setItem("usuario", JSON.stringify(actualizado)); // 🔹 actualizar local
    setRequiereCambio(false);
    setLoading(false);
  };

  // === LOGOUT ===
  const handleLogout = () => {
    setUsuario(null);
    setTelefono("");
    setClave("");
    setNuevaClave("");
    setConfirmarClave("");
    setRequiereCambio(false);
    localStorage.removeItem("usuario"); // 🔹 limpiar persistencia
  };

  // === Bloquear botón "atrás" del navegador una vez logueado ===
  useEffect(() => {
    if (usuario) {
      window.history.pushState(null, "", window.location.href);
      const handlePopState = () => {
        window.history.pushState(null, "", window.location.href);
      };
      window.addEventListener("popstate", handlePopState);
      return () => window.removeEventListener("popstate", handlePopState);
    }
  }, [usuario]);

  // === Bloquear pull-to-refresh en móviles ===
  useEffect(() => {
    const preventPullToRefresh = (e) => {
      if (e.touches.length !== 1) return;
      const touchY = e.touches[0].clientY;
      if (touchY < 50) e.preventDefault();
    };
    document.addEventListener("touchmove", preventPullToRefresh, { passive: false });
    return () => {
      document.removeEventListener("touchmove", preventPullToRefresh);
    };
  }, []);

  // === Permitir presionar ENTER ===
  const handleKeyPressLogin = (e) => {
    if (e.key === "Enter") handleLogin();
  };
  const handleKeyPressCambio = (e) => {
    if (e.key === "Enter") handleCambioClave();
  };

  // === LOGIN SCREEN ===
  if (!usuario) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white shadow-lg rounded-3xl p-8 w-full max-w-sm border border-gray-200 text-center animate-fadeIn">
          <div className="flex items-center justify-center space-x-6 mb-6">
            <img src="/liberty.png" alt="Logo Liberty" className="w-24 h-24 object-contain" />
            <img src="/logo_distel.png" alt="Logo Distel" className="w-24 h-24 object-contain" />
          </div>

          <h1 className="text-2xl font-bold text-gray-800 mb-2">Bienvenido</h1>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            Control de Clientes en Desabasto
          </h2>
          <p className="text-gray-600 mb-6">Ingrese su número y clave</p>

          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            value={telefono}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              setTelefono(val);
            }}
            onKeyDown={handleKeyPressLogin}
            placeholder="Ejemplo: 60123456"
            className="border rounded-lg p-3 w-full text-center text-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength="4"
            value={clave}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              setClave(val);
            }}
            onKeyDown={handleKeyPressLogin}
            placeholder="Clave (4 dígitos)"
            className="border rounded-lg p-3 w-full text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            onClick={handleLogin}
            disabled={loading}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg w-full transition-all disabled:opacity-50"
          >
            {loading ? "Verificando..." : "Ingresar"}
          </button>

          <p className="text-xs text-gray-400 mt-6">
            © 2025 Distel — Sistema de Control de Desabasto
          </p>
        </div>
      </div>
    );
  }

  // === CAMBIO DE CLAVE (primer ingreso) ===
  if (requiereCambio) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
        <div className="bg-white shadow-lg rounded-3xl p-8 w-full max-w-sm border border-gray-200 text-center animate-fadeIn">
          <h2 className="text-lg font-bold text-gray-800 mb-4">
            Hola {usuario.nombre}
          </h2>
          <p className="text-gray-700 mb-4">
            Por seguridad, debe cambiar su clave temporal antes de continuar.
          </p>

          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength="4"
            value={nuevaClave}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              setNuevaClave(val);
            }}
            onKeyDown={handleKeyPressCambio}
            placeholder="Nueva clave (4 dígitos)"
            className="border rounded-lg p-3 w-full text-center text-lg mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength="4"
            value={confirmarClave}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, "");
              setConfirmarClave(val);
            }}
            onKeyDown={handleKeyPressCambio}
            placeholder="Confirmar nueva clave"
            className="border rounded-lg p-3 w-full text-center text-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          <button
            onClick={handleCambioClave}
            disabled={loading}
            className="mt-4 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg w-full transition-all disabled:opacity-50"
          >
            {loading ? "Actualizando..." : "Guardar nueva clave"}
          </button>

          <button
            onClick={handleLogout}
            className="mt-3 text-sm text-gray-600 underline"
          >
            Cancelar
          </button>
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
            <p className="text-xs text-blue-100">Ruta: {usuario.ruta_excel}</p>
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

      <footer
        style={{
          textAlign: "center",
          padding: "10px",
          fontSize: "14px",
          color: "#555",
          backgroundColor: "#f9f9f9",
          position: "fixed",
          bottom: 0,
          width: "100%",
          borderTop: "1px solid #ddd",
        }}
      >
        © 2025 Distel — Sistema de Control de Desabasto
      </footer>
    </div>
  );
}
