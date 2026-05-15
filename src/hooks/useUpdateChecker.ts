import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";

// App açılışta bir kere sessizce update endpoint'ini kontrol eder, yeni sürüm
// varsa indirilebilir bir toast gösterir. Ağ yoksa / endpoint cevap vermiyorsa
// hiç ses çıkarmaz — boot deneyimini bozmaz.
export function useUpdateChecker(enabled: boolean) {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled || ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const update = await check();
        if (!update) return;

        const toastId = `updater-${update.version}`;
        toast.info(`Yeni sürüm hazır: v${update.version}`, {
          id: toastId,
          description: update.body || "Güncellemek için butona bas.",
          duration: Infinity,
          action: {
            label: "İndir ve kur",
            onClick: async () => {
              let total = 0;
              let downloaded = 0;
              toast.loading("Güncelleme indiriliyor…", { id: toastId });
              try {
                await update.downloadAndInstall((evt) => {
                  if (evt.event === "Started") {
                    total = evt.data.contentLength ?? 0;
                  } else if (evt.event === "Progress") {
                    downloaded += evt.data.chunkLength;
                    if (total > 0) {
                      const pct = Math.round((downloaded / total) * 100);
                      toast.loading(`İndiriliyor… %${pct}`, { id: toastId });
                    }
                  } else if (evt.event === "Finished") {
                    toast.success("Kuruldu, uygulama yeniden başlatılıyor…", {
                      id: toastId,
                    });
                  }
                });
              } catch (err) {
                toast.error("Güncelleme başarısız", {
                  id: toastId,
                  description: err instanceof Error ? err.message : String(err),
                });
              }
            },
          },
        });
      } catch {
        // sessiz geç — ağ yoksa kullanıcı her açılışta hata görmesin
      }
    })();
  }, [enabled]);
}
