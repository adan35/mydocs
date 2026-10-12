import { capabilityMarkdown } from '@/lib/convert/capabilities';
import { Dialog } from '../components/Dialog';
import { StaticMarkdown } from './StaticMarkdown';

/** The capability matrix, generated from the same table the converters use. */
export function FormatsDialog({ onClose }: { onClose(): void }) {
  return (
    <Dialog
      title="Supported formats"
      description="What MyDocs opens, edits, converts and exports, and what each conversion keeps or loses."
      onClose={onClose}
      size="lg"
      footer={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="max-h-[65vh] overflow-auto pb-2 text-[14px]" data-testid="formats-matrix">
        <StaticMarkdown text={capabilityMarkdown()} className="[--prose-size:14px]" />
      </div>
    </Dialog>
  );
}
