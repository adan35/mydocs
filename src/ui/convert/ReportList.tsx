import { AlertTriangle, Check, Info } from 'lucide-react';
import type { ReportData } from '@/lib/convert/doc-ast';

/** What a conversion keeps and loses, from its real report. */
export function ReportList({
  report,
  showKept = false,
}: {
  report: ReportData;
  showKept?: boolean;
}) {
  const kept = Object.entries(report.kept).filter(([, n]) => n > 0);
  return (
    <div className="mt-2 space-y-1.5" data-testid="conversion-report">
      {showKept && kept.length > 0 && (
        <p className="flex items-start gap-2 text-charcoal">
          <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />
          <span>
            Kept {kept.map(([k, n]) => `${n} ${n === 1 ? k.replace(/s$/, '') : k}`).join(', ')}.
          </span>
        </p>
      )}
      {report.notes.map((n) => (
        <p key={n.message} className="flex items-start gap-2 text-charcoal">
          {n.severity === 'warning' ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" aria-label="Loss" />
          ) : (
            <Info size={14} className="mt-0.5 shrink-0 text-steel" aria-label="Note" />
          )}
          <span>
            {n.message}
            {n.count && n.count > 1 ? ` (${n.count} places)` : ''}
          </span>
        </p>
      ))}
      {showKept && !report.notes.length && (
        <p className="flex items-start gap-2 text-charcoal">
          <Check size={14} className="mt-0.5 shrink-0 text-success" aria-hidden /> Nothing is lost
          in this conversion.
        </p>
      )}
    </div>
  );
}
