import { ShowcaseReel } from "@/features/showcase/components/ShowcaseReel";

export default function ShowcasePage() {
  return (
    <main className="flex min-h-[calc(100dvh-2rem)] flex-col items-center justify-center gap-5 px-4 py-8">
      <div className="w-full max-w-5xl">
        <ShowcaseReel />
      </div>
      <p className="max-w-2xl text-center font-display text-sm italic text-ink-muted">
        A 7.6 second looping product reel, built for screen recording.
      </p>
    </main>
  );
}
