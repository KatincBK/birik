import { useEffect, useState } from "react";

/**
 * navigator.onLine watcher — webview Chromium tabanlı, online/offline
 * eventleri Tauri'de gerçekçi şekilde tetiklenir. PLAN §11 edge case:
 * "Network yok → cache'den göster, üst barda 'Çevrimdışı' rozeti".
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}
