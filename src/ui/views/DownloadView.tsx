import { Download, ExternalLink } from 'lucide-react';
import { isNativeApp } from '@/platform';
import { DOWNLOADS, RELEASES_URL, detectOs, latestUrl } from '@/app/downloads';
import { Page } from '../components/Page';

/** Links to the newest installer for each system. Works without any server code. */
export function DownloadView() {
  const mine = detectOs();
  const cards = [...DOWNLOADS].sort((a, b) => Number(b.os === mine) - Number(a.os === mine));
  return (
    <Page
      title="Download My Doc"
      icon={<Download />}
      subtitle="The same workspace as an app on your computer or phone. Desktop apps update themselves."
    >
      {isNativeApp && (
        <p className="mb-6 text-[14px] text-steel">
          You are already using the My Doc app. These are the installers for your other devices.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {cards.map((t) => (
          <section
            key={t.os}
            aria-label={t.title}
            className={`rounded-xl border p-4 ${t.os === mine ? 'border-primary' : 'border-hairline'}`}
          >
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
              {t.title}
              {t.os === mine && (
                <span className="rounded-full bg-surface px-2 py-0.5 text-caption font-medium text-steel">
                  Your system
                </span>
              )}
            </h2>
            <ul className="mt-3 space-y-2">
              {t.options.map((o) => (
                <li key={o.file} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[14px] text-ink">{o.label}</div>
                    {o.note && <div className="text-caption text-steel">{o.note}</div>}
                  </div>
                  <a
                    className={`btn shrink-0 ${t.os === mine && o === t.options[0] ? 'btn-primary' : 'btn-secondary'}`}
                    href={latestUrl(o.file)}
                    rel="noopener"
                  >
                    <Download size={15} aria-hidden /> Download
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-6 text-caption text-steel">
        iPhone and iPad: open My Doc in Safari and choose Share → Add to Home Screen. Builds are not
        yet signed by Microsoft or Apple, so Windows and macOS may ask you to confirm the first
        launch.{' '}
        <a
          className="inline-flex items-center gap-1 text-primary"
          href={RELEASES_URL}
          rel="noopener"
        >
          All releases <ExternalLink size={12} aria-hidden />
        </a>
      </p>
    </Page>
  );
}
