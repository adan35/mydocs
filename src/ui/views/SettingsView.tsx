import type { ReactNode } from 'react';
import { Settings as SettingsIcon, Download, Keyboard } from 'lucide-react';
import { useSettings, type Settings } from '@/app/settings-store';
import { useApp } from '@/app/app-store';
import { dialogs } from '@/app/dialog-store';
import * as A from '@/app/actions';
import { formatBytes } from '@/domain/names';
import { Page } from '../components/Page';
import { useEffect, useState } from 'react';

function Section({
  title,
  children,
  description,
}: {
  title: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
      {description && <p className="mt-0.5 text-caption text-steel">{description}</p>}
      <div className="mt-3 divide-y divide-hairline-soft rounded-lg border border-hairline">
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-[14px] text-ink">
          {label}
        </label>
        {hint && <p className="text-caption text-steel">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-md bg-surface p-0.5">
      {options.map(([v, l]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          className={`h-7 rounded-[5px] px-3 text-caption font-medium ${value === v ? 'bg-canvas text-ink shadow-1' : 'text-steel hover:text-ink'}`}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  id,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  id: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-hairline-strong'}`}
      onClick={() => onChange(!checked)}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-1 transition-transform ${checked ? 'translate-x-4' : ''}`}
      />
    </button>
  );
}

export function SettingsView() {
  const s = useSettings();
  const set = (patch: Partial<Settings>) => s.update(patch);
  const session = useApp((st) => st.session);
  const persistent = useApp((st) => st.persistentStorage);
  const provider = useApp((st) => st.provider);
  const [usage, setUsage] = useState<{ usage?: number; quota?: number } | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then(setUsage, () => setUsage(null));
  }, []);
  const tree = session?.workspace.tree;

  return (
    <Page title="Settings" icon={<SettingsIcon />}>
      <Section title="Appearance">
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={s.theme}
            onChange={(theme) => set({ theme })}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
              ['system', 'System'],
            ]}
          />
        </Row>
        <Row label="Density" hint="Spacing in the sidebar and lists.">
          <Segmented
            label="Density"
            value={s.density}
            onChange={(density) => set({ density })}
            options={[
              ['comfortable', 'Comfortable'],
              ['compact', 'Compact'],
            ]}
          />
        </Row>
        <Row label="Text size" hint="Editor and reader." htmlFor="font-size">
          <div className="flex items-center gap-3">
            <input
              id="font-size"
              type="range"
              min={13}
              max={22}
              step={1}
              value={s.fontSize}
              onChange={(e) => set({ fontSize: Number(e.target.value) })}
              className="w-36 accent-[var(--primary)]"
            />
            <span className="w-10 text-right text-caption text-steel">{s.fontSize}px</span>
          </div>
        </Row>
        <Row label="Reading width">
          <Segmented
            label="Reading width"
            value={s.readingWidth}
            onChange={(readingWidth) => set({ readingWidth })}
            options={[
              ['narrow', 'Narrow'],
              ['normal', 'Normal'],
              ['wide', 'Wide'],
            ]}
          />
        </Row>
      </Section>

      <Section title="Editor">
        <Row label="Editor font">
          <Segmented
            label="Editor font"
            value={s.editorFont}
            onChange={(editorFont) => set({ editorFont })}
            options={[
              ['mono', 'Monospace'],
              ['sans', 'Sans serif'],
            ]}
          />
        </Row>
        <Row label="Open Markdown in">
          <Segmented
            label="Default view"
            value={s.defaultViewMode}
            onChange={(defaultViewMode) => set({ defaultViewMode })}
            options={[
              ['edit', 'Edit'],
              ['split', 'Split'],
              ['preview', 'Preview'],
            ]}
          />
        </Row>
        <Row label="Formatting toolbar" htmlFor="toolbar">
          <Toggle
            id="toolbar"
            checked={s.formatToolbar}
            onChange={(formatToolbar) => set({ formatToolbar })}
          />
        </Row>
        <Row label="Word wrap" htmlFor="wrap">
          <Toggle id="wrap" checked={s.wordWrap} onChange={(wordWrap) => set({ wordWrap })} />
        </Row>
        <Row label="Line numbers" htmlFor="lines">
          <Toggle
            id="lines"
            checked={s.lineNumbers}
            onChange={(lineNumbers) => set({ lineNumbers })}
          />
        </Row>
        <Row label="Spellcheck" htmlFor="spell">
          <Toggle
            id="spell"
            checked={s.spellcheck}
            onChange={(spellcheck) => set({ spellcheck })}
          />
        </Row>
        <Row
          label="Typewriter scrolling"
          hint="Keeps the line you're writing near the middle of the screen."
          htmlFor="typewriter"
        >
          <Toggle
            id="typewriter"
            checked={s.typewriter}
            onChange={(typewriter) => set({ typewriter })}
          />
        </Row>
        <Row label="Tab size">
          <Segmented
            label="Tab size"
            value={s.tabSize}
            onChange={(tabSize) => set({ tabSize })}
            options={[
              [2, '2'],
              [4, '4'],
            ]}
          />
        </Row>
        <Row
          label="Autosave delay"
          hint="How long after you stop typing before saving. Changes are always saved."
        >
          <Segmented
            label="Autosave delay"
            value={s.autosaveDelay}
            onChange={(autosaveDelay) => set({ autosaveDelay })}
            options={[
              [300, 'Fast'],
              [700, 'Normal'],
              [2000, 'Relaxed'],
            ]}
          />
        </Row>
      </Section>

      <Section title="Daily notes">
        <Row
          label="Daily notes folder"
          hint="Today's note opens with Ctrl/Cmd + Shift + D. Use / for subfolders."
          htmlFor="daily-folder"
        >
          <input
            id="daily-folder"
            className="input h-8 w-56"
            value={s.dailyFolder}
            onChange={(e) => set({ dailyFolder: e.target.value })}
            onBlur={(e) => set({ dailyFolder: e.target.value.trim() || 'Daily notes' })}
          />
        </Row>
      </Section>

      <Section title="Keyboard">
        <Row label="Keyboard shortcuts" hint="Custom shortcuts are planned for a later version.">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void dialogs.shortcuts()}
          >
            <Keyboard size={15} aria-hidden /> View shortcuts
          </button>
        </Row>
      </Section>

      <Section
        title="Storage"
        description="My Doc is local-first: everything is stored in this browser on this device."
      >
        <Row label="Provider">
          <span className="text-[14px] text-charcoal">{provider.label}</span>
        </Row>
        <Row
          label="Workspace"
          hint={
            tree
              ? `${tree.liveFiles().length} files · ${tree.liveEntries().filter((e) => e.kind === 'folder').length} folders`
              : undefined
          }
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void A.renameWorkspace()}
            >
              Rename
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void A.exportEntry(null, 'zip')}
            >
              <Download size={15} aria-hidden /> Export .zip
            </button>
          </div>
        </Row>
        <Row
          label="Storage used"
          hint={
            persistent
              ? 'Protected: the browser will not clear it automatically.'
              : 'The browser may clear this data under storage pressure. Export regularly to keep a backup.'
          }
        >
          <span className="text-[14px] text-charcoal">
            {usage?.usage !== undefined
              ? `${formatBytes(usage.usage)}${usage.quota ? ` of ${formatBytes(usage.quota)}` : ''}`
              : 'Unknown'}
          </span>
        </Row>
        <Row label="Delete workspace" hint="Permanently removes this workspace from this browser.">
          <button
            type="button"
            className="btn btn-secondary text-danger"
            onClick={() => void A.deleteWorkspace()}
          >
            Delete…
          </button>
        </Row>
      </Section>

      <p className="text-center text-xs text-stone">
        My Doc · Markdown at its core · Your documents never leave this device.
      </p>
      <div className="mt-2 text-center">
        <button
          type="button"
          className="text-xs text-steel hover:underline"
          onClick={() => s.reset()}
        >
          Reset settings to defaults
        </button>
      </div>
    </Page>
  );
}
