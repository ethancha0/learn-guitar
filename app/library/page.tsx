import { Upload } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { SongGrid } from "@/features/library/components/SongGrid";
import { songs } from "@/features/library/data/songs";

export default function LibraryPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Library"
        subtitle="Your imported songs. Pick one to open the player."
        actions={
          <Button disabled>
            <Upload className="h-4 w-4" />
            Import song
          </Button>
        }
      />
      <SongGrid songs={songs} />
    </div>
  );
}
