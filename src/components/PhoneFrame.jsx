import { useEffect, useState, useRef } from "react";

export default function PhoneFrame({
  children,
  showBackButton = false,
  onBack,
  onLogout,
  isLoginScreen = false, // 🔹 Nuevo: indica si la vista es login
}) {
  const [hora, setHora] = useState(getHoraCR());
  const frameRef = useRef(null);
  const contentRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const id = setInterval(() => setHora(getHoraCR()), 30000);
    return () => clearInterval(id);
  }, []);

  // === Ajuste dinámico solo si NO es login ===
  const ajustarEscala = () => {
    if (isLoginScreen) return; // mantener centrado normal
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content) return;

    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const cw = content.scrollWidth;
    const ch = content.scrollHeight;

    const factor = Math.min((fw * 0.97) / cw, (fh * 0.975) / ch);
    const offsetX = (fw - cw * factor) / 2;
    const offsetY = (fh - ch * factor) / 2;

    setScale(factor);
    setOffset({ x: offsetX, y: offsetY });
  };

  useEffect(() => {
    if (isLoginScreen) return; // no escalar login
    ajustarEscala();
    const observer = new ResizeObserver(ajustarEscala);
    observer.observe(document.body);
    window.addEventListener("orientationchange", ajustarEscala);
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", ajustarEscala);
    };
  }, [isLoginScreen]);

  const handleBack = () => {
    if (onBack) onBack();
    else window.history.back();
  };

  // === Login: sin tablet, centrado normal ===
  if (isLoginScreen) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-900">
        <div
          className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 text-center"
          style={{
            minHeight: "90vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  // === Vista tablet ===
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-900 overflow-hidden">
      <div
        className="
          relative flex items-center justify-center
          rounded-[30px] border-[6px]
          shadow-[0_25px_80px_rgba(0,0,0,0.65)]
        "
        style={{
          width: "min(1350px, 97vw)",
          height: "min(890px, 95vh)",
          background:
            "linear-gradient(145deg, #2c2c2c 0%, #1e1e1e 25%, #2b2b2b 60%, #121212 100%)",
          borderColor: "rgba(50,50,50,0.9)",
          boxShadow:
            "0 0 25px rgba(0,0,0,0.9), inset 0 0 15px rgba(255,255,255,0.05)",
        }}
      >
        {/* === Pantalla interna === */}
        <div
          ref={frameRef}
          className="
            relative bg-black rounded-[22px]
            border-[3px] border-neutral-800 flex flex-col
          "
          style={{
            width: "96%",
            height: "93%",
            boxShadow: "inset 0 0 25px rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Barra superior */}
          <div className="flex justify-between items-center px-6 py-3 bg-neutral-900 text-neutral-100 text-sm font-semibold z-10 w-full rounded-t-[18px]">
            <div className="flex items-center gap-3">
              {showBackButton && (
                <button
                  onClick={handleBack}
                  className="p-2 rounded-full hover:bg-neutral-800 active:scale-95 transition"
                  title="Volver"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    fill="none"
                    strokeWidth="2"
                  >
                    <path
                      d="M15 6l-6 6 6 6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>

            {onLogout && (
              <button
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 text-white text-xs sm:text-sm px-3 py-1 rounded-md transition"
              >
                Cerrar sesión
              </button>
            )}
          </div>

          {/* Contenido ajustado con scroll interno */}
          <div
            ref={contentRef}
            className="flex items-center justify-center flex-1 bg-neutral-950"
            style={{
              overflowY: "auto",
              overflowX: "hidden",
              width: "100%",
              alignItems: "stretch",
            }}
          >
            <div
              className="origin-top-left transition-transform duration-500 ease-out w-full"
              style={{
                transformOrigin: "center",
                transform: `scale(${scale})`,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div
                className="w-[1280px] min-h-[800px] flex flex-col bg-neutral-950 overflow-y-auto"
                style={{
                  maxHeight: "800px",
                  paddingBottom: "40px",
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* === Función auxiliar para mostrar la hora en formato CR === */
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
