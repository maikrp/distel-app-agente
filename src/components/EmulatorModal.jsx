import { useEffect, useState } from "react";

/**
 * EmulatorModal
 * Simula una tablet horizontal (10 pulgadas aprox.) para versión web.
 * Incluye marco, barra superior con hora y opciones, y área de scroll interno.
 */
export default function EmulatorModal({
  children,
  showBackButton = false,
  onBack,
  onLogout,
}) {
  const [hora, setHora] = useState(getHoraCR());

  useEffect(() => {
    const id = setInterval(() => setHora(getHoraCR()), 30000);
    return () => clearInterval(id);
  }, []);

  const handleBack = () => {
    if (onBack) onBack();
    else window.history.back();
  };

  return (
    <div
      className="flex items-center justify-center w-screen h-screen bg-neutral-800 overflow-hidden"
      style={{ padding: "2vh 0" }}
    >
      {/* Marco de tablet horizontal */}
      <div
        className="relative bg-neutral-900 rounded-[32px] shadow-[0_0_60px_rgba(0,0,0,0.5)] border-[8px] border-neutral-700 overflow-hidden flex flex-col"
        style={{
          width: "min(95vw, 1280px)", // Tablet horizontal
          height: "min(90vh, 800px)",
        }}
      >
        {/* Barra superior */}
        <div className="flex justify-between items-center bg-neutral-950 text-neutral-200 px-6 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            {showBackButton && (
              <button
                onClick={handleBack}
                aria-label="Volver"
                className="p-2 rounded-full hover:bg-neutral-800 active:scale-95 transition"
              >
                <svg width="22" height="22" viewBox="0 0 24 24">
                  <path
                    d="M15 6l-6 6 6 6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <span className="text-sm font-semibold">{hora}</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-xs opacity-80">Distel CR</span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-1 px-3 rounded-md transition"
              >
                Cerrar sesión
              </button>
            )}
          </div>
        </div>

        {/* Contenido con scroll */}
        <div
          className="flex-1 overflow-y-auto bg-neutral-950"
          style={{ padding: "1.5rem" }}
        >
          {children}
        </div>

        {/* Barra inferior */}
        <div className="h-10 bg-neutral-900 border-t border-neutral-800 flex items-center justify-center text-neutral-500 text-xs">
          © 2025 Distel — Sistema Manejo de Desabasto
        </div>
      </div>
    </div>
  );
}

/* === Función auxiliar para hora local === */
function getHoraCR() {
  try {
    return new Date().toLocaleTimeString("es-CR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }
}
