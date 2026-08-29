import { PageHeader } from "@/components/ui/PageHeader";
import { ImportSongDialog } from "@/features/library/components/ImportSongDialog";
import { LibrarySongGrid } from "@/features/library/components/LibrarySongGrid";

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Library"
        subtitle="Your imported songs. Pick one to open the player."
        actions={<ImportSongDialog />}
      />
      <LibrarySongGrid />
    </div>
  );
}
