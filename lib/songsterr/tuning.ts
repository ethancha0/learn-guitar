const PITCH_CLASSES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

/** MIDI note number -> scientific pitch name, e.g. 43 -> "G2". */
export function midiNoteName(note: number): string {
  const pitchClass = PITCH_CLASSES[((note % 12) + 12) % 12];
  return `${pitchClass}${Math.floor(note / 12) - 1}`;
}

/**
 * Songsterr lists tunings high string first, which is how tab conventionally
 * reads. `[43, 38, 33, 28]` -> "G2 D2 A1 E1" (bass standard).
 */
export function tuningLabel(tuning?: number[]): string | undefined {
  if (!tuning?.length) return undefined;
  return tuning.map(midiNoteName).join(" ");
}
