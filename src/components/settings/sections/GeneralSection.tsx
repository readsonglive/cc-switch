import { useTranslation } from "react-i18next";
import { ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import type { Settings } from "@/types";
import type { SettingsFormState } from "@/hooks/useSettings";
import { useTheme } from "@/components/theme-provider";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { isLinux } from "@/lib/platform";
import { TerminalSelect } from "@/components/settings/TerminalSettings";
import {
  SettingsBlock,
  SettingsCard,
  SettingsRow,
  SettingsSwitchRow,
} from "@/components/settings/SettingsLayout";

type Language = SettingsFormState["language"];
type UpdateCheckFrequency = NonNullable<Settings["updateCheckFrequency"]>;

// Radix 的 Select 不允许空串 value；用哨兵值 "manual" 表示"仅手动"
const MANUAL_SENTINEL = "manual";

const UPDATE_FREQ_OPTIONS: { value: UpdateCheckFrequency; labelKey: string }[] = [
  { value: "hourly", labelKey: "settings.general.updateFreqHourly" },
  { value: "daily", labelKey: "settings.general.updateFreqDaily" },
  { value: "weekly", labelKey: "settings.general.updateFreqWeekly" },
  { value: "yearly", labelKey: "settings.general.updateFreqYearly" },
];

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => i + 1);

const LANGUAGES: { value: Language; labelKey: string }[] = [
  { value: "zh", labelKey: "settings.languageOptionChinese" },
  { value: "zh-TW", labelKey: "settings.languageOptionTraditionalChinese" },
  { value: "en", labelKey: "settings.languageOptionEnglish" },
  { value: "ja", labelKey: "settings.languageOptionJapanese" },
];

interface GeneralSectionProps {
  settings: SettingsFormState;
  onAutoSave: (updates: Partial<SettingsFormState>) => Promise<boolean>;
  onOpenApps: () => void;
}

export function GeneralSection({
  settings,
  onAutoSave,
  onOpenApps,
}: GeneralSectionProps) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <>
      <SettingsBlock title={t("settings.general.appearance")}>
        <SettingsCard>
          <SettingsRow
            label={t("settings.language")}
            control={
              <Select
                value={settings.language}
                onValueChange={(value) =>
                  void onAutoSave({ language: value as Language })
                }
              >
                <SelectTrigger
                  className="h-8 w-[160px]"
                  aria-label={t("settings.language")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((language) => (
                    <SelectItem key={language.value} value={language.value}>
                      {t(language.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label={t("settings.theme")}
            control={
              <SegmentedControl
                size="sm"
                aria-label={t("settings.theme")}
                value={theme}
                onValueChange={setTheme}
                items={[
                  {
                    value: "system",
                    label: t("settings.themeSystem"),
                    icon: Monitor,
                  },
                  {
                    value: "light",
                    label: t("settings.themeLight"),
                    icon: Sun,
                  },
                  {
                    value: "dark",
                    label: t("settings.themeDark"),
                    icon: Moon,
                  },
                ]}
              />
            }
          />
          <SettingsRow
            label={t("settings.general.quotaDisplay")}
            help={{
              title: t("settings.general.quotaDisplay"),
              body: t("settings.general.quotaDisplayHelp"),
            }}
            control={
              <SegmentedControl
                size="sm"
                aria-label={t("settings.general.quotaDisplay")}
                value={settings.quotaDisplay ?? "left"}
                onValueChange={(value) =>
                  void onAutoSave({ quotaDisplay: value })
                }
                items={[
                  {
                    value: "left",
                    label: t("settings.general.quotaDisplayLeft"),
                  },
                  {
                    value: "used",
                    label: t("settings.general.quotaDisplayUsed"),
                  },
                ]}
              />
            }
          />
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock title={t("settings.general.sidebarAndHeader")}>
        <SettingsCard>
          <SettingsRow
            label={t("settings.general.visibleApps")}
            control={
              <Button variant="quiet" size="compact" onClick={onOpenApps}>
                {t("settings.general.goToApps")}
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <SettingsSwitchRow
            label={t("settings.appVisibility.showProfileSwitcher")}
            help={{
              title: t("settings.appVisibility.showProfileSwitcher"),
              body: t("settings.appVisibility.showProfileSwitcherDescription"),
            }}
            checked={settings.showProfileSwitcher ?? false}
            onCheckedChange={(value) =>
              void onAutoSave({ showProfileSwitcher: value })
            }
          />
          <SettingsSwitchRow
            label={t("settings.appVisibility.showProviderSearch")}
            help={{
              title: t("settings.appVisibility.showProviderSearch"),
              body: t("settings.appVisibility.showProviderSearchDescription"),
            }}
            checked={settings.showProviderSearch ?? true}
            onCheckedChange={(value) =>
              void onAutoSave({ showProviderSearch: value })
            }
          />
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock title={t("settings.general.updates")}>
        <SettingsCard>
          <SettingsSwitchRow
            label={t("settings.general.checkToolUpdates")}
            help={{
              title: t("settings.general.checkToolUpdates"),
              body: t("settings.general.checkToolUpdatesHelp"),
            }}
            checked={settings.checkToolUpdatesOnStartup ?? false}
            onCheckedChange={(value) =>
              void onAutoSave({ checkToolUpdatesOnStartup: value })
            }
          />
          <SettingsRow
            label={t("settings.general.updateCheckFrequency")}
            help={{
              title: t("settings.general.updateCheckFrequency"),
              body: t("settings.general.updateCheckFrequencyHelp"),
            }}
            control={
              <Select
                value={settings.updateCheckFrequency ?? MANUAL_SENTINEL}
                onValueChange={(value) =>
                  void onAutoSave({
                    updateCheckFrequency:
                      value === MANUAL_SENTINEL
                        ? undefined
                        : (value as UpdateCheckFrequency),
                    // 切到「仅手动」或离开年频率时，清理无用的字段
                    ...(value === MANUAL_SENTINEL
                      ? {
                          updateCheckTime: undefined,
                          updateCheckMonth: undefined,
                          updateCheckDay: undefined,
                        }
                      : {}),
                    ...(value !== MANUAL_SENTINEL && value !== "yearly"
                      ? {
                          updateCheckMonth: undefined,
                          updateCheckDay: undefined,
                        }
                      : {}),
                  })
                }
              >
                <SelectTrigger
                  className="h-8 w-[160px]"
                  aria-label={t("settings.general.updateCheckFrequency")}
                >
                  <SelectValue
                    placeholder={t("settings.general.updateFreqManual")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL_SENTINEL}>
                    {t("settings.general.updateFreqManual")}
                  </SelectItem>
                  {UPDATE_FREQ_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          {settings.updateCheckFrequency === "yearly" ? (
            <>
              <SettingsRow
                label={t("settings.general.updateCheckMonth")}
                control={
                  <Select
                    value={String(settings.updateCheckMonth ?? 1)}
                    onValueChange={(value) =>
                      void onAutoSave({ updateCheckMonth: Number(value) })
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-[160px]"
                      aria-label={t("settings.general.updateCheckMonth")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_OPTIONS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
              <SettingsRow
                label={t("settings.general.updateCheckDay")}
                control={
                  <Select
                    value={String(settings.updateCheckDay ?? 1)}
                    onValueChange={(value) =>
                      void onAutoSave({ updateCheckDay: Number(value) })
                    }
                  >
                    <SelectTrigger
                      className="h-8 w-[160px]"
                      aria-label={t("settings.general.updateCheckDay")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DAY_OPTIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
              />
            </>
          ) : settings.updateCheckFrequency ? (
            <SettingsRow
              label={t("settings.general.updateCheckTime")}
              control={
                <input
                  type="time"
                  step={1}
                  className="h-8 rounded-control border border-border-strong bg-surface px-2 text-body text-fg-1 transition-[border-color,box-shadow] focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/20 dark:focus:ring-ring/15"
                  value={settings.updateCheckTime ?? "00:00:00"}
                  onChange={(e) =>
                    void onAutoSave({ updateCheckTime: e.target.value })
                  }
                />
              }
            />
          ) : null}
        </SettingsCard>
      </SettingsBlock>

      <SettingsBlock title={t("settings.general.windowAndTerminal")}>
        <SettingsCard>
          <SettingsSwitchRow
            label={t("settings.launchOnStartup")}
            checked={!!settings.launchOnStartup}
            onCheckedChange={(value) =>
              void onAutoSave({ launchOnStartup: value })
            }
          />
          {settings.launchOnStartup && (
            <SettingsSwitchRow
              label={t("settings.silentStartup")}
              help={{
                title: t("settings.silentStartup"),
                body: t("settings.silentStartupDescription"),
              }}
              checked={!!settings.silentStartup}
              onCheckedChange={(value) =>
                void onAutoSave({ silentStartup: value })
              }
            />
          )}
          <SettingsSwitchRow
            label={t("settings.minimizeToTray")}
            help={{
              title: t("settings.minimizeToTray"),
              body: t("settings.general.minimizeToTrayHelp"),
            }}
            checked={settings.minimizeToTrayOnClose}
            onCheckedChange={(value) =>
              void onAutoSave({ minimizeToTrayOnClose: value })
            }
          />
          {isLinux() && (
            <SettingsSwitchRow
              label={t("settings.useAppWindowControls")}
              help={{
                title: t("settings.useAppWindowControls"),
                body: t("settings.useAppWindowControlsDescription"),
              }}
              checked={!!settings.useAppWindowControls}
              onCheckedChange={(value) =>
                void onAutoSave({ useAppWindowControls: value })
              }
            />
          )}
          <SettingsRow
            label={t("settings.terminal.title")}
            help={{
              title: t("settings.terminal.title"),
              body: t("settings.general.terminalHelp"),
            }}
            control={
              <TerminalSelect
                className="h-8 w-[160px]"
                value={settings.preferredTerminal}
                onChange={(terminal) =>
                  void onAutoSave({ preferredTerminal: terminal })
                }
              />
            }
          />
        </SettingsCard>
      </SettingsBlock>
    </>
  );
}
