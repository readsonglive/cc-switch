import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Settings } from "@/types";
import { settingsApi } from "@/lib/api/settings";
import { useSettingsQuery } from "@/lib/query";

type Language = NonNullable<Settings["language"]>;

const LANGUAGES: { value: Language; labelKey: string }[] = [
  { value: "zh", labelKey: "settings.languageOptionChinese" },
  { value: "zh-TW", labelKey: "settings.languageOptionTraditionalChinese" },
  { value: "en", labelKey: "settings.languageOptionEnglish" },
  { value: "ja", labelKey: "settings.languageOptionJapanese" },
  { value: "tr", labelKey: "settings.languageOptionTurkish" },
];

/**
 * 侧栏顶栏的语言选择器。
 * 立即切换界面语言并写入 localStorage 缓存，同步持久化到后端 settings.json
 * （启动时 syncLanguageFromSettings 用后端值校正界面语言）。
 */
export function LanguageSelector({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useSettingsQuery();
  const current = (i18n.language as Language) || "zh";

  const change = (value: string) => {
    const lang = value as Language;
    void i18n.changeLanguage(lang);
    try {
      localStorage.setItem("language", lang);
    } catch {
      // localStorage 不可用时忽略
    }
    // 尽力同步到后端 settings.json；失败时本地缓存仍生效
    if (settings) {
      void settingsApi
        .save({ ...settings, language: lang })
        .then(() => queryClient.invalidateQueries({ queryKey: ["settings"] }))
        .catch((error) =>
          console.warn("[LanguageSelector] 保存语言设置失败", error),
        );
    }
  };

  return (
    <Select value={current} onValueChange={change}>
      <SelectTrigger
        className={cn(
          "h-7 w-auto min-w-0 gap-1 rounded-control border-transparent bg-transparent px-1.5 text-caption text-fg-2 shadow-none transition-colors hover:bg-subtle hover:text-fg-1",
          className,
        )}
        aria-label={t("settings.language")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[140px]">
        {LANGUAGES.map((language) => (
          <SelectItem key={language.value} value={language.value}>
            {t(language.labelKey)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
