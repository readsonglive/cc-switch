import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpenRouterSourceSectionProps {
  apiKey?: string;
  onChange: (key: string | undefined) => void;
}

export function OpenRouterSourceSection({
  apiKey,
  onChange,
}: OpenRouterSourceSectionProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <section
      aria-labelledby="openrouter-source-title"
      className="flex flex-col gap-3"
    >
      <h3
        id="openrouter-source-title"
        className="m-0 text-strong font-semibold text-fg-1"
      >
        {t("usage.global.settingsTitle")}
      </h3>
      <p className="text-caption text-fg-3">{t("usage.global.settingsHint")}</p>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={visible ? "text" : "password"}
            value={apiKey ?? ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            placeholder={t("usage.global.apiKeyPlaceholder")}
            className={cn(
              "h-8 w-full rounded-control border border-border bg-surface px-2.5 pr-8 text-caption text-fg-1 outline-none transition-[border-color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/20",
            )}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-3 transition-colors hover:text-fg-1"
            aria-label={visible ? t("common.hide") : t("common.show")}
          >
            {visible ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
      <p className="text-caption text-fg-3">
        {t("usage.global.settingsFallback")}
      </p>
    </section>
  );
}
