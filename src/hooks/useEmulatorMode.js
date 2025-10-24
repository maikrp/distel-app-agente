import { useEffect, useState } from "react";

export default function useEmulatorMode() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
    setIsDesktop(!isMobile);
  }, []);

  return isDesktop;
}
