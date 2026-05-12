import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, type HealthInfo } from "../lib/api";

type DbStatus = "loading" | "ready" | "error";

type DbInitResult = {
  status: DbStatus;
  error: string | null;
  health: HealthInfo | null;
};

/**
 * Boot-time DB readiness check via Tauri invoke.
 *
 * Rust setup hook'u DB pool'unu yaratıyor ve migration'ları uyguluyor;
 * bu hook sadece sonucu doğrular. db_health_check çağrısı pool'a
 * basit count sorguları çeker.
 */
export function useDbInit(): DbInitResult {
  const [status, setStatus] = useState<DbStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await api.health();
        if (cancelled) return;
        setHealth(info);
        setStatus("ready");
        console.info("[birik] db ready", info);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
        toast.error("Veritabanı yüklenemedi", { description: msg });
        console.error("[birik] db init failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { status, error, health };
}
