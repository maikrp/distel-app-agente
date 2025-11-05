/* ============================================================================
   App.jsx — versión 1.3.1 CORREGIDA FINAL
   - Mantiene sesión compartida entre subdominios (.distelcr.com)
   - Permite visitar visitas.distelcr.com sin bloqueo
   - Evita bucles al regresar al menú principal
   - Limpia cookie, sessionStorage y URL solo una vez
   - Conserva estructura y lógica completas de versión 1.2.8
   ============================================================================ */

import { useState, useEffect } from "react";
import bcrypt from "bcryptjs";
import { supabase } from "./supabaseClient";
import AgentDashboard from "./components/AgentDashboard";
import SupervisorMenu from "./components/SupervisorMenu";
import GlobalSupervisorMenu from "./components/GlobalSupervisorMenu";
import EmulatorModal from "./components/EmulatorModal";
import useEmulatorMode from "./hooks/useEmulatorMode";
import AdminToolsPanel from "./components/AdminToolsPanel";

export default function App() {
  const [telefono, setTelefono] = useState("");
  const [clave, setClave] = useState("");
  const [nuevaClave, setNuevaClave] = useState("");
  const [confirmarClave, setConfirmarClave] = useState("");
  const [usuario, setUsuario] = useState(() => {
    try {
      const stored = localStorage.getItem("usuario");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const allowVistas = new Set(["login", "cambioClave", "menuPrincipal", "desabasto", "adminTools"]);
  const [loading, setLoading] = useState(false);
  const initialVista = (() => {
    const v = localStorage.getItem("vista") || "login";
    return allowVistas.has(v) ? v : "login";
  })();
  const [requiereCambio, setRequiereCambio] = useState(false);
  const [vista, setVista] = useState(initialVista);
  const [redirecting, setRedirecting] = useState(false);

  const isDesktop = useEmulatorMode();

  /* --------------------------------------------------------------------------
     ANTI-LOOP Y SANITIZACIÓN DE URL AL MONTAR (v1.3.1)
     - Permite salida a visitas.distelcr.com
     - Limpia cookie y sessionStorage solo al regresar
     - No bloquea el botón de salida
  -------------------------------------------------------------------------- */
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      const sensitiveParams = ["telefono", "nombre", "acceso"];
      const hasSensitive = sensitiveParams.some((p) => params.has(p));

      const cameFromVisitas =
        document.referrer && /https?:\/\/visitas\.distelcr\.com/i.test(document.referrer);

      // Detectar retorno legítimo desde visitas
      const returnedFromVisitas =
        cameFromVisitas && sessionStorage.getItem("redirectToVisitas") === "true";

      if (returnedFromVisitas) {
        // Limpieza completa al volver
        sessionStorage.removeItem("redirectToVisitas");
        sessionStorage.removeItem("handledVisitasReturn");
        document.cookie =
          "distelSession=; Max-Age=0; path=/; domain=.distelcr.com; secure; samesite=strict";
        localStorage.removeItem("vista");

        setRedirecting(false);
        setVista(usuario ? "menuPrincipal" : "login");
      }

      if (hasSensitive) {
        url.search = "";
        url.hash = "";
        window.history.replaceState(null, "", url.toString());
      }
    } catch {
      // no-op
    }
  }, []);

  // --- LOGIN ---
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
      localStorage.setItem("usuario", JSON.stringify(agente));
      setRequiereCambio(true);
      setVista("cambioClave");
      setLoading(false);
      return;
    }

    const usuarioVerificado = {
      nombre: agente.nombre,
      telefono: agente.telefono,
      acceso: agente.acceso,
      tipo: agente.tipo,
      region: agente.region,
      ruta_excel: agente.ruta_excel,
      activo: agente.activo,
    };

    setUsuario(usuarioVerificado);
    localStorage.setItem("usuario", JSON.stringify(usuarioVerificado));

    const sessionData = {
      telefono: usuarioVerificado.telefono,
      nombre: usuarioVerificado.nombre,
      acceso: usuarioVerificado.acceso,
      region: usuarioVerificado.region,
    };
    document.cookie = `distelSession=${btoa(
      JSON.stringify(sessionData)
    )}; path=/; domain=.distelcr.com; secure; samesite=strict`;

    setVista("menuPrincipal");
    setLoading(false);
  };

  // --- CAMBIO DE CLAVE ---
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
      .update({ clave: nuevaHash, clave_temporal: false })
      .eq("telefono", usuario.telefono);

    if (error) {
      alert("Error al actualizar la clave.");
      setLoading(false);
      return;
    }

    alert("Clave actualizada correctamente. Puede continuar.");
    const actualizado = { ...usuario, clave_temporal: false };
    setUsuario(actualizado);
    localStorage.setItem("usuario", JSON.stringify(actualizado));
    setRequiereCambio(false);
    setVista("menuPrincipal");
    setLoading(false);
  };

  // --- LOGOUT GLOBAL ---
  const handleLogout = () => {
    document.cookie =
      "distelSession=; Max-Age=0; path=/; domain=.distelcr.com; secure; samesite=strict";

    setUsuario(null);
    setTelefono("");
    setClave("");
    setNuevaClave("");
    setConfirmarClave("");
    setRequiereCambio(false);
    setVista("login");
    localStorage.removeItem("usuario");
    localStorage.removeItem("vista");
    sessionStorage.removeItem("redirectToVisitas");
  };

  // --- EFECTOS ---
  useEffect(() => {
    if (!usuario) {
      setVista("login");
      return;
    }
    if (usuario && !allowVistas.has(vista)) {
      setVista("menuPrincipal");
    }

    window.history.pushState(null, "", window.location.href);
    const handlePopState = () => window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [usuario]);

  useEffect(() => {
    if (allowVistas.has(vista)) {
      localStorage.setItem("vista", vista);
    } else {
      localStorage.removeItem("vista");
    }
  }, [vista]);

  useEffect(() => {
    let lastY = 0;
    const preventPullToRefresh = (e) => {
      const y = e.touches[0].clientY;
      if (y > lastY && window.scrollY === 0) e.preventDefault();
      lastY = y;
    };
    document.addEventListener("touchmove", preventPullToRefresh, { passive: false });
    return () => document.removeEventListener("touchmove", preventPullToRefresh);
  }, []);

  const handleKeyPressLogin = (e) => {
    if (e.key === "Enter") handleLogin();
  };
  const handleKeyPressCambio = (e) => {
    if (e.key === "Enter") handleCambioClave();
  };

  // --- LOGIN SCREEN ---
  const loginScreen = (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center sm:block sm:pt-10">
      <div className="w-full flex items-center justify-center">
        <div
          className="bg-white shadow-lg rounded-3xl p-8 text-center border border-gray-200 animate-fadeIn"
          style={{ width: "360px", maxWidth: "90%" }}
        >
          <div className="flex items-center justify-center space-x-6 mb-6">
            <img src="/liberty.png" alt="Logo Liberty" className="w-24 h-24 object-contain" />
            <img src="/logo_distel.png" alt="Logo Distel" className="w-24 h-24 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Bienvenido</h1>
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            Sistema de Administración de Clientes Distel
          </h2>
          <p className="text-gray-600 mb-6">Ingrese su usuario y contraseña</p>
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value.replace(/\D/g, ""))}
            onKeyDown={handleKeyPressLogin}
            placeholder="Ejemplo: 60123456"
            className="border rounded-lg p-3 w-full text-center text-lg mb-3 focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength="4"
            value={clave}
            onChange={(e) => setClave(e.target.value.replace(/\D/g, ""))}
            onKeyDown={handleKeyPressLogin}
            placeholder="Clave (4 dígitos)"
            className="border rounded-lg p-3 w-full text-center text-lg focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg w-full disabled:opacity-50"
          >
            {loading ? "Verificando..." : "Ingresar"}
          </button>
          <p className="text-xs text-gray-400 mt-6">
            © 2025 Distel — Sistema Manejo de Clientes Ver.1.3.1
          </p>
        </div>
      </div>
    </div>
  );

  // --- CAMBIO DE CLAVE ---
  const cambioClaveScreen = (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-3xl p-8 w-full max-w-sm border border-gray-200 text-center animate-fadeIn">
        <h2 className="text-lg font-bold text-gray-800 mb-4">Hola {usuario?.nombre || ""}</h2>
        <p className="text-gray-700 mb-4">
          Por seguridad, debe cambiar su clave temporal antes de continuar.
        </p>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength="4"
          value={nuevaClave}
          onChange={(e) => setNuevaClave(e.target.value.replace(/\D/g, ""))}
          onKeyDown={handleKeyPressCambio}
          placeholder="Nueva clave (4 dígitos)"
          className="border rounded-lg p-3 w-full text-center text-lg mb-3 focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength="4"
          value={confirmarClave}
          onChange={(e) => setConfirmarClave(e.target.value.replace(/\D/g, ""))}
          onKeyDown={handleKeyPressCambio}
          placeholder="Confirmar nueva clave"
          className="border rounded-lg p-3 w-full text-center text-lg focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleCambioClave}
          disabled={loading}
          className="mt-4 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg w-full disabled:opacity-50"
        >
          {loading ? "Actualizando..." : "Guardar nueva clave"}
        </button>
        <button onClick={handleLogout} className="mt-3 text-sm text-gray-600 underline">
          Cancelar
        </button>
      </div>
    </div>
  );

  // --- MENÚ PRINCIPAL ---
  const menuPrincipal = (
    <div className="min-h-screen bg-gray-100 flex items-start justify-center pt-10 sm:pt-12 md:pt-16">
      <div className="bg-white shadow-lg rounded-3xl p-6 text-center border border-gray-200 w-[360px] max-w-[90%] max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-center space-x-6 mb-6">
          <img src="/liberty.png" alt="Logo Liberty" className="w-24 h-24 object-contain" />
          <img src="/logo_distel.png" alt="Logo Distel" className="w-24 h-24 object-contain" />
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Menú Principal</h1>
        <h2 className="text-lg font-semibold text-gray-700 mb-6">
          Bienvenido {usuario?.nombre || ""}
        </h2>

        <div className="space-y-3">
          <button
            onClick={() => setVista("desabasto")}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold"
          >
            Manejo Desabasto
          </button>

          <button
            onClick={() => {
              if (!redirecting) {
                setRedirecting(true);
                sessionStorage.setItem("redirectToVisitas", "true");
                window.location.href = "https://visitas.distelcr.com/?_=" + Date.now();
                setTimeout(() => setRedirecting(false), 1500);
              }
            }}
            className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-semibold"
          >
            Actualización de Clientes
          </button>

          <button
            onClick={() => alert("Función de actualización de cliente en desarrollo")}
            className="w-full bg-yellow-500 hover:bg-yellow-600 text-white py-3 rounded-lg font-semibold"
          >
            Control de Ingreso
          </button>

          {usuario?.acceso === "superadmin" && (
            <button
              onClick={() => setVista("adminTools")}
              className="w-full bg-gray-800 hover:bg-gray-900 text-white py-3 rounded-lg font-semibold"
            >
              🧰 Panel de Administración
            </button>
          )}

          <button
            onClick={handleLogout}
            className="w-full bg-red-600 hover:bg-red-700 text-white py-3 rounded-lg font-semibold"
          >
            Cerrar Sesión
          </button>
        </div>

        <p className="text-xs text-gray-400 mt-6">© 2025 Distel — Menú Principal</p>
      </div>
    </div>
  );

  // --- DESABASTO ---
  const desabastoScreen = (
    <div className="bg-gray-50 flex flex-col sm:min-h-screen">
      <div className="flex justify-between items-center p-4 bg-blue-700 text-white">
        <div>
          <h2 className="text-lg font-semibold">{usuario?.nombre}</h2>
          <p className="text-sm">
            {usuario?.tipo} —{" "}
            {usuario?.acceso?.toLowerCase() === "global"
              ? "GLOBAL"
              : usuario?.region?.toUpperCase()}
          </p>
          {usuario?.ruta_excel && (
            <p className="text-xs text-blue-100">Ruta: {usuario?.ruta_excel}</p>
          )}
        </div>
        <button
          onClick={() => setVista("menuPrincipal")}
          className="bg-white text-blue-700 px-3 py-1 rounded-lg font-semibold"
        >
          Menú
        </button>
      </div>

      <div className="p-4 flex-1 overflow-auto">
        {usuario?.acceso === "ruta" && <AgentDashboard usuario={usuario} />}
        {usuario?.acceso === "regional" && <SupervisorMenu usuario={usuario} />}
        {(usuario?.acceso === "global" || usuario?.acceso === "superadmin") && (
          <GlobalSupervisorMenu usuario={usuario} />
        )}
      </div>

      <footer className="text-center p-2 text-sm text-gray-600 border-t">
        © 2025 Distel — Sistema Manejo de Desabasto Ver.1.3.1
      </footer>
    </div>
  );

  const adminToolsScreen = <AdminToolsPanel onVolver={() => setVista("menuPrincipal")} />;

  let contenido;
  if (vista === "login") contenido = loginScreen;
  else if (vista === "cambioClave") contenido = cambioClaveScreen;
  else if (vista === "menuPrincipal") contenido = menuPrincipal;
  else if (vista === "desabasto") contenido = desabastoScreen;
  else if (vista === "adminTools") contenido = adminToolsScreen;
  else contenido = loginScreen;

  const wrapperClass = isDesktop ? "emulator-desktop-mode" : "";

  return (
    <>
      {isDesktop ? (
        <EmulatorModal showBackButton={!!usuario} onBack={handleLogout}>
          <div className={wrapperClass}>{contenido}</div>
        </EmulatorModal>
      ) : (
        <div className="flex flex-col h-screen overflow-auto">{contenido}</div>
      )}
    </>
  );
}
