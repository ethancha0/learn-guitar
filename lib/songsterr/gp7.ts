/**
 * Builds a Guitar Pro 7 file from Songsterr's per-track revision JSON by
 * assembling an alphaTab score model and running alphaTab's GP7 exporter.
 *
 * Two mappings drive most of the code here:
 *
 * - String numbering is reversed. Songsterr's string 0 is the highest-pitched
 *   string; alphaTab's string 1 is the lowest. Hence `numStrings - string`.
 * - Percussion sounds are referenced by their index into alphaTab's
 *   articulation list, not by MIDI note, so drums need a lookup table.
 */

import * as alphaTab from "@coderline/alphatab";
import { mapSongsterrDuration } from "./duration";
import {
  DRUM_INSTRUMENT_ID,
  type ConversionWarning,
  type SongsterrBeatPayload,
  type SongsterrMeasurePayload,
  type SongsterrNotePayload,
  type SongsterrPart,
  type SongsterrPartPayload,
  type SongsterrRevisionAutomationTempoPoint,
  type SongsterrRevisionMeta,
  type SongsterrVoicePayload,
} from "./revision";

const MAX_WARNINGS = 200;

/** MIDI reserves channel 9 for percussion. */
const PERCUSSION_CHANNEL = 9;

/**
 * alphaTab's tempo `reference` is an index, not a note denominator:
 * 0 = whole, 1 = half, 2 = quarter, 3 = dotted quarter, 4 = double whole.
 * Songsterr BPM is always quarter-note based.
 */
const QUARTER_NOTE_TEMPO_REFERENCE = 2;

const DYNAMICS_BY_NAME: Record<string, alphaTab.model.DynamicValue> = {
  ppp: alphaTab.model.DynamicValue.PPP,
  pp: alphaTab.model.DynamicValue.PP,
  p: alphaTab.model.DynamicValue.P,
  mp: alphaTab.model.DynamicValue.MP,
  mf: alphaTab.model.DynamicValue.MF,
  f: alphaTab.model.DynamicValue.F,
  ff: alphaTab.model.DynamicValue.FF,
  fff: alphaTab.model.DynamicValue.FFF,
};

const HARMONIC_TYPES: Record<string, alphaTab.model.HarmonicType> = {
  natural: alphaTab.model.HarmonicType.Natural,
  artificial: alphaTab.model.HarmonicType.Artificial,
  pinch: alphaTab.model.HarmonicType.Pinch,
  tap: alphaTab.model.HarmonicType.Tap,
  semi: alphaTab.model.HarmonicType.Semi,
  feedback: alphaTab.model.HarmonicType.Feedback,
};

const SLIDE_IN_TYPES: Record<string, alphaTab.model.SlideInType> = {
  into_from_below: alphaTab.model.SlideInType.IntoFromBelow,
  below: alphaTab.model.SlideInType.IntoFromBelow,
  into_from_above: alphaTab.model.SlideInType.IntoFromAbove,
};

const SLIDE_OUT_TYPES: Record<string, alphaTab.model.SlideOutType> = {
  shift: alphaTab.model.SlideOutType.Shift,
  legato: alphaTab.model.SlideOutType.Legato,
  out_up: alphaTab.model.SlideOutType.OutUp,
  upwards: alphaTab.model.SlideOutType.OutUp,
  out_down: alphaTab.model.SlideOutType.OutDown,
  downwards: alphaTab.model.SlideOutType.OutDown,
};

export interface Gp7ConversionInput {
  meta: SongsterrRevisionMeta;
  parts: SongsterrPart[];
}

export interface Gp7ConversionResult {
  data: Uint8Array;
  warnings: ConversionWarning[];
}

function pushWarning(warnings: ConversionWarning[], warning: ConversionWarning): void {
  if (warnings.length < MAX_WARNINGS) warnings.push(warning);
}

/**
 * GP7 references drum sounds by their position in alphaTab's articulation list
 * rather than by MIDI note. Rather than hard-coding those 95 indices, derive
 * them once by exporting a throwaway percussion track and reading back the list
 * alphaTab wrote, which stays correct across alphaTab versions.
 */
function buildPercussionIndexMap(): Map<number, number> {
  const score = new alphaTab.model.Score();
  score.addMasterBar(new alphaTab.model.MasterBar());

  const track = new alphaTab.model.Track();
  track.playbackInfo.primaryChannel = PERCUSSION_CHANNEL;
  track.playbackInfo.secondaryChannel = PERCUSSION_CHANNEL;

  const staff = new alphaTab.model.Staff();
  staff.isPercussion = true;
  track.addStaff(staff);

  const bar = new alphaTab.model.Bar();
  const voice = new alphaTab.model.Voice();
  const beat = new alphaTab.model.Beat();
  beat.isEmpty = true;
  voice.addBeat(beat);
  bar.addVoice(voice);
  staff.addBar(bar);
  score.addTrack(track);

  const settings = new alphaTab.Settings();
  score.finish(settings);
  const data = new alphaTab.exporter.Gp7Exporter().export(score, settings);
  const reimported = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, settings);

  const map = new Map<number, number>();
  const articulations = reimported.tracks[0].percussionArticulations;
  for (let i = 0; i < articulations.length; i += 1) {
    const id = articulations[i].id;
    if (!map.has(id)) map.set(id, i);
  }
  return map;
}

let percussionIndexMap: Map<number, number> | null = null;

/**
 * Must be called before any score construction starts, never while a score is
 * being assembled. `buildPercussionIndexMap` runs a full alphaTab export/import
 * round trip, and doing that mid-assembly corrupts the in-progress score: bars
 * come out with duplicated voices where the first copy carries no articulations,
 * and those silent beats fill the measure so the real drum beats land past the
 * bar end and never sound. Because the map is cached in module state, building
 * it lazily only ever broke the first conversion in a process.
 */
function ensurePercussionIndexMap(): Map<number, number> {
  if (!percussionIndexMap) percussionIndexMap = buildPercussionIndexMap();
  return percussionIndexMap;
}

interface PlaybackMapping {
  program: number;
  isPercussion: boolean;
}

function mapInstrumentToPlayback(instrumentId: number | undefined): PlaybackMapping {
  if (instrumentId === DRUM_INSTRUMENT_ID) {
    return { program: 0, isPercussion: true };
  }
  return {
    program:
      typeof instrumentId === "number" ? Math.min(Math.max(instrumentId, 0), 127) : 24,
    isPercussion: false,
  };
}

/** A tuplet plays `n` notes in the space of the nearest lower power of two. */
function tupletRatio(tuplet: number): [number, number] {
  switch (tuplet) {
    case 3:
      return [3, 2];
    case 5:
      return [5, 4];
    case 6:
      return [6, 4];
    case 7:
      return [7, 4];
    case 9:
      return [9, 8];
    case 10:
      return [10, 8];
    case 12:
      return [12, 8];
    default:
      if (tuplet > 1) return [tuplet, 2 ** Math.floor(Math.log2(tuplet))];
      return [1, 1];
  }
}

function markerText(marker: SongsterrMeasurePayload["marker"]): string {
  if (typeof marker === "string") return marker;
  if (marker && typeof marker.text === "string") return marker.text;
  return "";
}

function validSignature(
  signature: [number, number] | undefined,
): [number, number] | null {
  if (!Array.isArray(signature) || signature.length !== 2) return null;
  const [numerator, denominator] = signature;
  if (!numerator || !denominator) return null;
  return [numerator, denominator];
}

/** The longest track defines the song's bar count, time signatures and tempo. */
function pickMasterPart(parts: SongsterrPart[]): SongsterrPartPayload | null {
  if (parts.length === 0) return null;
  return parts.reduce((longest, current) =>
    (current.payload.measures?.length ?? 0) > (longest.payload.measures?.length ?? 0)
      ? current
      : longest,
  ).payload;
}

function fillWithRestBeats(
  voice: alphaTab.model.Voice,
  masterBar: alphaTab.model.MasterBar,
): void {
  const numerator = masterBar.timeSignatureNumerator || 4;
  const denominator = masterBar.timeSignatureDenominator || 4;
  const mapped = mapSongsterrDuration([1, denominator]);

  for (let i = 0; i < numerator; i += 1) {
    const beat = new alphaTab.model.Beat();
    beat.isEmpty = true;
    beat.duration = mapped.duration;
    beat.dots = mapped.dots;
    voice.addBeat(beat);
  }
}

function applyTempoAutomations(
  score: alphaTab.model.Score,
  points: SongsterrRevisionAutomationTempoPoint[],
  warnings: ConversionWarning[],
): void {
  for (const point of points) {
    const masterBar = score.masterBars[point.measure];
    if (!masterBar) {
      pushWarning(warnings, {
        code: "tempo_measure_out_of_range",
        message: `Tempo automation references missing measure ${point.measure}.`,
        location: `measure:${point.measure}`,
      });
      continue;
    }

    const ratioPosition =
      point.position > 0
        ? Math.max(0, Math.min(1, point.position / (point.type || 4)))
        : 0;

    masterBar.tempoAutomations.push(
      alphaTab.model.Automation.buildTempoAutomation(
        false,
        ratioPosition,
        point.bpm,
        QUARTER_NOTE_TEMPO_REFERENCE,
        true,
      ),
    );
  }
}

function buildMasterBars({
  score,
  masterPart,
  masterBarCount,
  warnings,
}: {
  score: alphaTab.model.Score;
  masterPart: SongsterrPartPayload | null;
  masterBarCount: number;
  warnings: ConversionWarning[];
}): void {
  // Songsterr only records a signature on bars where it changes.
  let numerator = 4;
  let denominator = 4;

  for (let index = 0; index < masterBarCount; index += 1) {
    const measure = masterPart?.measures?.[index];
    const signature = validSignature(measure?.signature);
    if (signature) [numerator, denominator] = signature;

    const masterBar = new alphaTab.model.MasterBar();
    masterBar.timeSignatureNumerator = numerator;
    masterBar.timeSignatureDenominator = denominator;

    if (measure?.marker) {
      const section = new alphaTab.model.Section();
      section.marker = markerText(measure.marker);
      section.text = section.marker;
      masterBar.section = section;
    }
    if (measure?.repeatStart) {
      masterBar.isRepeatStart = true;
    }
    if (typeof measure?.repeatCount === "number" && measure.repeatCount > 0) {
      masterBar.repeatCount = measure.repeatCount;
    }
    if (typeof measure?.alternateEnding === "number" && measure.alternateEnding > 0) {
      masterBar.alternateEndings = measure.alternateEnding;
    }

    score.addMasterBar(masterBar);
  }

  const tempo = masterPart?.automations?.tempo;
  applyTempoAutomations(score, Array.isArray(tempo) ? tempo : [], warnings);
}

function mapBend(
  note: alphaTab.model.Note,
  bend: NonNullable<SongsterrNotePayload["bend"]>,
): void {
  const points = bend.points;
  if (!points?.length) return;

  // Songsterr measures bends in cents; alphaTab in quarter-tone steps.
  const toAlphaTabValue = (tone: number) => Math.round(tone / 25);

  const firstTone = points[0].tone;
  const lastPoint = points[points.length - 1];

  // A bend that starts above pitch was already bent before the note sounded.
  if (firstTone > 0) {
    const firstValue = toAlphaTabValue(firstTone);
    const maxTone = Math.max(...points.map((point) => point.tone));

    if (maxTone > firstTone) {
      note.bendType = alphaTab.model.BendType.PrebendBend;
      note.addBendPoint(new alphaTab.model.BendPoint(0, firstValue));
      note.addBendPoint(new alphaTab.model.BendPoint(60, toAlphaTabValue(maxTone)));
    } else if (lastPoint.tone < firstTone) {
      note.bendType = alphaTab.model.BendType.PrebendRelease;
      note.addBendPoint(new alphaTab.model.BendPoint(0, firstValue));
      note.addBendPoint(new alphaTab.model.BendPoint(60, toAlphaTabValue(lastPoint.tone)));
    } else {
      note.bendType = alphaTab.model.BendType.Prebend;
      note.addBendPoint(new alphaTab.model.BendPoint(0, firstValue));
      note.addBendPoint(new alphaTab.model.BendPoint(60, toAlphaTabValue(lastPoint.tone)));
    }
    return;
  }

  note.bendType = alphaTab.model.BendType.Custom;

  // Guitar Pro renders at most a start, a peak and an end, so a dense Songsterr
  // curve is reduced to those three rather than emitted point for point.
  let pointsToUse = points;
  if (points.length > 4) {
    let peakIndex = 0;
    let maxTone = 0;
    for (let i = 0; i < points.length; i += 1) {
      if (points[i].tone >= maxTone) {
        maxTone = points[i].tone;
        peakIndex = i;
      }
    }
    pointsToUse =
      peakIndex === 0 || peakIndex === points.length - 1
        ? [points[0], lastPoint]
        : [points[0], points[peakIndex], lastPoint];
  }

  for (const point of pointsToUse) {
    note.addBendPoint(
      new alphaTab.model.BendPoint(Math.round(point.position), toAlphaTabValue(point.tone)),
    );
  }
}

function mapNote({
  noteData,
  beatData,
  isPercussion,
  numStrings,
  warnings,
  location,
}: {
  noteData: SongsterrNotePayload;
  beatData: SongsterrBeatPayload;
  isPercussion: boolean;
  numStrings: number;
  warnings: ConversionWarning[];
  location: string;
}): alphaTab.model.Note {
  const note = new alphaTab.model.Note();

  // Must stay negative for drums so alphaTab's `isStringed` returns false.
  note.string = isPercussion ? -1 : numStrings - (noteData.string ?? 0);
  note.fret = noteData.fret ?? 0;

  if (isPercussion) {
    // Songsterr stores the drum's MIDI note in `fret`.
    const midiNote = noteData.fret ?? 0;
    note.percussionArticulation = ensurePercussionIndexMap().get(midiNote) ?? midiNote;
  }

  if (noteData.tie) note.isTieDestination = true;
  if (noteData.dead) note.isDead = true;
  if (noteData.ghost) note.isGhost = true;
  if (noteData.hp) note.isHammerPullOrigin = true;
  if (noteData.staccato) note.isStaccato = true;
  if (noteData.accentuated) note.accentuated = alphaTab.model.AccentuationType.Normal;
  // Songsterr records palm mute per beat, Guitar Pro per note.
  if (beatData.palmMute) note.isPalmMute = true;

  if (noteData.wideVibrato) {
    note.vibrato = alphaTab.model.VibratoType.Wide;
  } else if (noteData.vibrato) {
    note.vibrato = alphaTab.model.VibratoType.Slight;
  }

  if (typeof noteData.slide === "string") {
    const slide = noteData.slide.toLowerCase();
    const slideOut = SLIDE_OUT_TYPES[slide];
    const slideIn = SLIDE_IN_TYPES[slide];
    if (slideOut !== undefined) {
      note.slideOutType = slideOut;
    } else if (slideIn !== undefined) {
      note.slideInType = slideIn;
    } else {
      pushWarning(warnings, {
        code: "slide_unsupported",
        message: `Unsupported slide effect "${noteData.slide}".`,
        location,
      });
    }
  }

  if (typeof noteData.harmonic === "string") {
    const harmonic = HARMONIC_TYPES[noteData.harmonic.toLowerCase()];
    if (harmonic !== undefined) {
      note.harmonicType = harmonic;
      if (typeof noteData.harmonicFret === "number") {
        note.harmonicValue = noteData.harmonicFret;
      }
    } else {
      pushWarning(warnings, {
        code: "harmonic_unsupported",
        message: `Unsupported harmonic type "${noteData.harmonic}".`,
        location,
      });
    }
  }

  if (noteData.bend?.points?.length) {
    mapBend(note, noteData.bend);
  }

  return note;
}

function mapBeat({
  beatData,
  isPercussion,
  numStrings,
  warnings,
  location,
}: {
  beatData: SongsterrBeatPayload;
  isPercussion: boolean;
  numStrings: number;
  warnings: ConversionWarning[];
  location: string;
}): alphaTab.model.Beat {
  const beat = new alphaTab.model.Beat();
  if (beatData.rest) beat.isEmpty = true;

  const mapped = mapSongsterrDuration(beatData.duration);
  beat.duration = mapped.duration;
  beat.dots = beatData.dots ?? mapped.dots;

  const text = typeof beatData.text === "string" ? beatData.text : beatData.text?.text;
  beat.text = text || null;

  // Tuplet durations are meant to be inexact fractions, so don't flag those.
  if (mapped.isApproximate && !beatData.tuplet) {
    pushWarning(warnings, {
      code: "duration_approximated",
      message: `Approximated unsupported duration ${JSON.stringify(beatData.duration)}.`,
      location,
    });
  }

  if (typeof beatData.tuplet === "number" && beatData.tuplet > 1) {
    const [numerator, denominator] = tupletRatio(beatData.tuplet);
    beat.tupletNumerator = numerator;
    beat.tupletDenominator = denominator;

    // The `duration` fraction already has the tuplet folded in, so the base
    // note value has to come from `type` or the beat ends up too short.
    if (typeof beatData.type === "number" && beatData.type > 0) {
      beat.duration = mapSongsterrDuration([1, beatData.type]).duration;
      beat.dots = beatData.dots ?? 0;
    }
  }

  if (typeof beatData.velocity === "string") {
    const dynamics = DYNAMICS_BY_NAME[beatData.velocity.toLowerCase()];
    if (dynamics !== undefined) {
      beat.dynamics = dynamics;
    } else {
      pushWarning(warnings, {
        code: "velocity_unknown",
        message: `Unsupported beat velocity "${beatData.velocity}".`,
        location,
      });
    }
  }

  if (typeof beatData.pickStroke === "string") {
    const pickStroke = beatData.pickStroke.toLowerCase();
    if (pickStroke === "down") beat.pickStroke = alphaTab.model.PickStroke.Down;
    else if (pickStroke === "up") beat.pickStroke = alphaTab.model.PickStroke.Up;
  }

  if (beatData.wideVibrato || beatData.vibratoWithTremoloBar) {
    beat.vibrato = alphaTab.model.VibratoType.Wide;
  } else if (beatData.vibrato) {
    beat.vibrato = alphaTab.model.VibratoType.Slight;
  }

  const notes = beatData.notes ?? [];
  for (let index = 0; index < notes.length; index += 1) {
    if (notes[index].rest) continue;
    beat.addNote(
      mapNote({
        noteData: notes[index],
        beatData,
        isPercussion,
        numStrings,
        warnings,
        location: `${location}|note:${index}`,
      }),
    );
  }

  return beat;
}

function fillVoice({
  voice,
  sourceVoice,
  masterBar,
  isPercussion,
  numStrings,
  warnings,
  location,
}: {
  voice: alphaTab.model.Voice;
  sourceVoice: SongsterrVoicePayload | undefined;
  masterBar: alphaTab.model.MasterBar;
  isPercussion: boolean;
  numStrings: number;
  warnings: ConversionWarning[];
  location: string;
}): void {
  const beats = sourceVoice?.beats ?? [];
  if (beats.length === 0 || sourceVoice?.rest) {
    fillWithRestBeats(voice, masterBar);
    return;
  }

  for (let index = 0; index < beats.length; index += 1) {
    voice.addBeat(
      mapBeat({
        beatData: beats[index],
        isPercussion,
        numStrings,
        warnings,
        location: `${location}|beat:${index}`,
      }),
    );
  }

  if (voice.beats.length === 0) {
    fillWithRestBeats(voice, masterBar);
  }
}

function buildTrack({
  score,
  part,
  masterBarCount,
  channel,
  warnings,
}: {
  score: alphaTab.model.Score;
  part: SongsterrPart;
  masterBarCount: number;
  channel: number;
  warnings: ConversionWarning[];
}): void {
  const { trackMeta, payload } = part;
  const playback = mapInstrumentToPlayback(trackMeta.instrumentId ?? payload.instrumentId);

  const track = new alphaTab.model.Track();
  track.name = trackMeta.title || trackMeta.name || payload.name || "Track";
  track.shortName = track.name.slice(0, 20);
  track.playbackInfo.program = playback.program;
  // Without a channel per track, program changes collide and every track ends
  // up playing the same instrument.
  track.playbackInfo.primaryChannel = channel;
  track.playbackInfo.secondaryChannel = channel;

  const staff = new alphaTab.model.Staff();
  const tuning = payload.tuning ?? trackMeta.tuning;
  if (Array.isArray(tuning) && tuning.length > 0) {
    staff.stringTuning = new alphaTab.model.Tuning("Custom", tuning, false);
  }
  const isPercussion = playback.isPercussion || Boolean(trackMeta.isDrums);
  staff.isPercussion = isPercussion;
  const numStrings = Array.isArray(tuning) ? tuning.length : 6;

  // alphaTab expects every bar in a staff to carry the same number of voices;
  // a mismatch crashes when the score is finished.
  let maxVoiceCount = 1;
  for (let index = 0; index < masterBarCount; index += 1) {
    maxVoiceCount = Math.max(
      maxVoiceCount,
      payload.measures?.[index]?.voices?.length ?? 0,
    );
  }

  for (let measureIndex = 0; measureIndex < masterBarCount; measureIndex += 1) {
    const bar = new alphaTab.model.Bar();
    const measure = payload.measures?.[measureIndex];
    const voices = measure?.voices ?? [];

    for (let voiceIndex = 0; voiceIndex < voices.length; voiceIndex += 1) {
      const voice = new alphaTab.model.Voice();
      fillVoice({
        voice,
        sourceVoice: voices[voiceIndex],
        masterBar: score.masterBars[measureIndex],
        isPercussion,
        numStrings,
        warnings,
        location: `part:${trackMeta.partId}|measure:${measureIndex}|voice:${voiceIndex}`,
      });
      bar.addVoice(voice);
    }

    // Tracks that stop early, or bars with fewer voices, are padded with rests.
    for (let index = bar.voices.length; index < maxVoiceCount; index += 1) {
      const restVoice = new alphaTab.model.Voice();
      fillWithRestBeats(restVoice, score.masterBars[measureIndex]);
      bar.addVoice(restVoice);
    }

    staff.addBar(bar);
  }

  track.addStaff(staff);
  score.addTrack(track);
}

function buildScore({ meta, parts }: Gp7ConversionInput): {
  score: alphaTab.model.Score;
  settings: alphaTab.Settings;
  warnings: ConversionWarning[];
} {
  const warnings: ConversionWarning[] = [];

  // See ensurePercussionIndexMap: this has to happen before the score exists.
  ensurePercussionIndexMap();

  const score = new alphaTab.model.Score();
  score.title = meta.title;
  score.artist = meta.artist;
  score.tab = "Songsterr";

  const masterBarCount = Math.max(
    1,
    parts.reduce((max, part) => Math.max(max, part.payload.measures?.length ?? 0), 0),
  );

  buildMasterBars({
    score,
    masterPart: pickMasterPart(parts),
    masterBarCount,
    warnings,
  });

  let nextChannel = 0;
  for (const part of parts) {
    const instrumentId = part.trackMeta.instrumentId ?? part.payload.instrumentId;
    const isPercussion = instrumentId === DRUM_INSTRUMENT_ID || Boolean(part.trackMeta.isDrums);

    let channel: number;
    if (isPercussion) {
      channel = PERCUSSION_CHANNEL;
    } else {
      if (nextChannel === PERCUSSION_CHANNEL) nextChannel += 1;
      channel = nextChannel;
      nextChannel += 1;
    }

    buildTrack({ score, part, masterBarCount, channel, warnings });
  }

  return { score, settings: new alphaTab.Settings(), warnings };
}

/** Convert fetched Songsterr revision parts into Guitar Pro 7 file bytes. */
export function convertRevisionToGp7(input: Gp7ConversionInput): Gp7ConversionResult {
  const { score, settings, warnings } = buildScore(input);
  // Finalizes ties, tuplets and durations; the exporter needs it.
  score.finish(settings);

  return {
    data: new alphaTab.exporter.Gp7Exporter().export(score, settings),
    warnings,
  };
}
