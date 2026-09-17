import { PageHeader } from "@/components/ui/PageHeader";
import { CatalogueEyebrow } from "@/features/library/components/CatalogueEyebrow";
import { ImportSongDialog } from "@/features/library/components/ImportSongDialog";
import { LibrarySongGrid } from "@/features/library/components/LibrarySongGrid";

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        eyebrow={<CatalogueEyebrow />}
        title="Library"
        subtitle="Open the score, or drop into rhythm practice."
        actions={<ImportSongDialog />}
      />
      <LibrarySongGrid />
    </div>
  );
}
