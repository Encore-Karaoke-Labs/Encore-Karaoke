import { Sequencer } from "spessasynth_lib";
import {
  BasicMIDI,
  MIDIMessageTypes as midiMessageTypes,
} from "spessasynth_core";
import { PitchDetector } from "pitchy";
import { logVerbose } from "../core/State.js";
import { bindSpessaEvent } from "./Synthesizer.js";

const GUIDE_CLARITY_THRESHOLD = 0.5;
const MIN_VOCAL_HZ = 75;
const MAX_VOCAL_HZ = 1200;

/**
 * Attempts to detect the correct text encoding for MIDI lyrics data to prevent mojibake.
 *
 * @param {Uint8Array} uint8Array - The raw byte data of the lyrics.
 * @returns {string} The identified encoding standard.
 */
function detectEncoding(uint8Array) {
  const encodings = [
    "utf-8",
    "shift-jis",
    "euc-kr",
    "windows-1250",
    "windows-1252",
    "utf-16le",
  ];
  for (const encoding of encodings) {
    try {
      const decoder = new TextDecoder(encoding, { fatal: true });
      const text = decoder.decode(uint8Array);
      if (text.includes("\uFFFD")) continue;
      const controlChars = (text.match(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g) || [])
        .length;
      if (text.length > 0 && controlChars / text.length > 0.05) continue;
      return encoding;
    } catch (e) {
      continue;
    }
  }
  return "utf-8";
}

export class FortePlayback {
  /**
   * Initializes the Playback Controller.
   * @param {Object} state - Global Forte state.
   * @param {Object} audioCore - Reference to the ForteAudioCore instance.
   * @param {Object} synthesizer - Reference to the ForteSynthesizer instance.
   * @param {Object} scoring - Reference to the ForteScoring instance.
   * @param {Object} pianoRoll - Reference to the FortePianoRoll instance.
   * @param {Function} dispatchUpdate - Callback to notify UI of state changes.
   */
  constructor(
    state,
    audioCore,
    synthesizer,
    scoring,
    pianoRoll,
    dispatchUpdate,
  ) {
    this.state = state;
    this.audioCore = audioCore;
    this.synthesizer = synthesizer;
    this.scoring = scoring;
    this.pianoRoll = pianoRoll;
    this.dispatchUpdate = dispatchUpdate;

    this.sourceNode = null;
    this.animationFrameId = null;
    this.lastScoreTime = 0;
    this.guideVolumeSwitchTimeout = null;

    this.timingLoop = this.timingLoop.bind(this);
  }

  /**
   * Primary synchronization loop processing active playback progression and UI updates.
   */
  timingLoop() {
    if (this.state.playback.status !== "playing") {
      this.animationFrameId = null;
      return;
    }

    const now = performance.now();
    let delta = (now - this.state.playback.lastFrameTime) / 1000;
    if (delta > 0.1) delta = 0.1;
    this.state.playback.lastFrameTime = now;

    const engineState = this.getPlaybackState();
    const engineTime = engineState.currentTime;
    const duration = engineState.duration;

    let rate = 1.0;
    if (!this.state.playback.isMidi && this.sourceNode) {
      rate = this.sourceNode.playbackRate.value;
    }

    this.state.playback.smoothedTime += delta * rate;

    const drift = engineTime - this.state.playback.smoothedTime;
    if (Math.abs(drift) > 0.5) {
      this.state.playback.smoothedTime = engineTime;
    } else {
      this.state.playback.smoothedTime += drift * 0.15;
    }

    const currentTime = Math.max(
      0,
      Math.min(this.state.playback.smoothedTime, duration),
    );

    if (this.state.ui.pianoRollVisible) {
      this.pianoRoll.render(currentTime);
    }

    if (this.state.scoring.enabled) {
      if (now - this.lastScoreTime > 33) {
        this.scoring.updateScore(currentTime);
        document.dispatchEvent(
          new CustomEvent("CherryTree.Forte.Scoring.Update", {
            detail: this.scoring.getScoringState(),
          }),
        );
        this.lastScoreTime = now;
      }
    }

    document.dispatchEvent(
      new CustomEvent("CherryTree.Forte.Playback.TimeUpdate", {
        detail: { currentTime, duration },
      }),
    );

    if (engineTime >= duration && duration > 0) {
      this.animationFrameId = null;
      if (this.state.playback.status === "playing") {
        this.stopTrack();
      }
      return;
    }

    this.animationFrameId = requestAnimationFrame(this.timingLoop);
  }

  /**
   * Starts a background asynchronous chunked processing routine measuring Multiplex pitch lines.
   *
   * @param {AudioBuffer} audioBuffer - Full track decoded buffer containing isolated guide track on right channel.
   */
  startIncrementalGuideAnalysis(audioBuffer) {
    console.log("[FORTE SVC] Starting incremental analysis for piano roll...");
    this.state.playback.isAnalyzing = true;
    const channelData = audioBuffer.getChannelData(1);
    const sampleRate = audioBuffer.sampleRate;

    const bufferSize = 2048;
    const detector = PitchDetector.forFloat32Array(bufferSize);

    const minNoteDuration = 0.08;
    const stepSize = 1024;
    let noteIdCounter = this.state.playback.guideNotes.length;

    let analysisPosition = 0;
    const analysisChunkDurationS = 2;
    const analysisChunkSamples = analysisChunkDurationS * sampleRate;

    let currentNote = null;

    const processChunk = () => {
      if (!this.state.playback.isAnalyzing) {
        console.log("[FORTE SVC] Incremental analysis stopped.");
        return;
      }

      const chunkEndPosition = Math.min(
        analysisPosition + analysisChunkSamples,
        channelData.length - bufferSize,
      );
      const foundNotes = [];
      const dataLen = channelData.length;

      for (let i = analysisPosition; i < chunkEndPosition; i += stepSize) {
        const chunk = channelData.subarray(i, i + bufferSize);
        const [pitch, clarity] = detector.findPitch(chunk, sampleRate);
        const time = i / sampleRate;

        const midiPitch = 12 * Math.log2(pitch / 440) + 69;

        const isNoteActive =
          clarity > GUIDE_CLARITY_THRESHOLD &&
          pitch >= MIN_VOCAL_HZ &&
          pitch <= MAX_VOCAL_HZ &&
          midiPitch >= 0 &&
          midiPitch < 128;

        if (isNoteActive) {
          if (!currentNote) {
            currentNote = {
              midi: midiPitch,
              startTime: time,
              pitches: [midiPitch],
            };
          } else {
            currentNote.pitches.push(midiPitch);
          }
        } else if (currentNote) {
          const duration = time - currentNote.startTime;
          if (duration > minNoteDuration) {
            let pSum = 0;
            const pLen = currentNote.pitches.length;
            for (let k = 0; k < pLen; k++) pSum += currentNote.pitches[k];

            foundNotes.push({
              id: noteIdCounter++,
              pitch: pSum / pLen,
              startTime: currentNote.startTime,
              duration: duration,
            });
          }
          currentNote = null;
        }
      }

      if (foundNotes.length > 0) {
        const lastGlobalNote =
          this.state.playback.guideNotes[
            this.state.playback.guideNotes.length - 1
          ];
        const firstChunkNote = foundNotes[0];

        if (
          lastGlobalNote &&
          firstChunkNote.startTime -
            (lastGlobalNote.startTime + lastGlobalNote.duration) <
            0.05 &&
          Math.abs(firstChunkNote.pitch - lastGlobalNote.pitch) < 1.0
        ) {
          lastGlobalNote.duration =
            firstChunkNote.startTime +
            firstChunkNote.duration -
            lastGlobalNote.startTime;
          foundNotes.shift();
        }

        this.state.playback.guideNotes.push(...foundNotes);

        if (this.state.ui.pianoRollVisible) {
          this.pianoRoll.render(this.getPlaybackState().currentTime);
        }
      }

      analysisPosition = chunkEndPosition;
      if (analysisPosition < dataLen - bufferSize) {
        setTimeout(processChunk, 16);
      } else {
        if (currentNote) {
          const time = (dataLen - 1) / sampleRate;
          const duration = time - currentNote.startTime;
          if (duration > minNoteDuration) {
            let pSum = 0;
            for (let k = 0; k < currentNote.pitches.length; k++)
              pSum += currentNote.pitches[k];

            const finalNote = {
              id: noteIdCounter++,
              pitch: pSum / currentNote.pitches.length,
              startTime: currentNote.startTime,
              duration: duration,
            };
            this.state.playback.guideNotes.push(finalNote);
            if (this.state.ui.pianoRollVisible)
              this.pianoRoll.render(this.getPlaybackState().currentTime);
          }
        }
        this.state.playback.isAnalyzing = false;
        logVerbose("Incremental guide analysis complete.");
      }
    };

    setTimeout(processChunk, 16);
  }

  /**
   * Primary load sequencer formatting tracks and establishing variables specific to decoding contexts.
   *
   * @param {string} url - The targeted local media.
   * @returns {Promise<boolean>} True if all media segments parsed cleanly.
   */
  async loadTrack(url) {
    if (!this.audioCore.context) return false;
    if (this.state.playback.status !== "stopped") this.stopTrack();

    if (this.state.playback.sequencer) {
      try {
        this.state.playback.sequencer.pause();
      } catch (e) {}
      try {
        this.state.playback.sequencer.currentTime = 0;
      } catch (e) {}
      this.state.playback.sequencer = null;
    }

    this.state.playback.midiInfo = {
      ticks: [],
      timeDivision: 480,
      tempoChanges: [],
      initialBpm: 120,
      keyRange: { min: 0, max: 127 },
    };
    this.state.playback.decodedLyrics = [];
    this.state.playback.lyricsEncoding = "utf-8";
    this.state.playback.transpose = 0;
    this.state.playback.isMultiplexed = false;
    this.state.playback.multiplexPan = -1;
    this.state.playback.guideNotes = [];
    this.state.playback.guideRange = { min: 42, max: 90 };
    this.state.playback.isAnalyzing = false;
    this.state.scoring.activeMidiNotes.clear();

    this.pianoRoll.toggleVisibility(false);

    const isMidi =
      url.toLowerCase().endsWith(".mid") ||
      url.toLowerCase().endsWith(".midi") ||
      url.toLowerCase().endsWith(".kar");
    this.state.playback.isMidi = isMidi;
    if (!isMidi && url.toLowerCase().includes(".multiplexed.")) {
      this.state.playback.isMultiplexed = true;
    }

    logVerbose("Preparing to load track", {
      url,
      isMidi,
      isMultiplexed: this.state.playback.isMultiplexed,
    });

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();

      if (isMidi) {
        if (!this.state.playback.synthesizer)
          throw new Error("MIDI Synthesizer not ready.");

        let parsedMidi;
        try {
          parsedMidi = BasicMIDI.fromArrayBuffer(arrayBuffer);
        } catch (e) {
          console.error("[FORTE SVC] BasicMIDI parsing failed:", e);
          throw e;
        }

        let primaryLyricTrackEvents = [];
        let highestLyricScore = 0;

        parsedMidi.tracks.forEach((midiTrack) => {
          let trackLyricScore = 0;
          const isKar = parsedMidi.isKaraokeFile;
          const trackTextEvents = midiTrack.events.filter(
            (e) =>
              e.statusByte === midiMessageTypes.lyric ||
              (isKar && e.statusByte === midiMessageTypes.text),
          );

          trackTextEvents.forEach((e) => {
            if (!e.data || e.data.length === 0) return;
            const firstChar = String.fromCharCode(e.data[0]);
            if (firstChar !== "@" && firstChar !== "#") trackLyricScore++;
          });

          if (trackLyricScore > highestLyricScore) {
            highestLyricScore = trackLyricScore;
            primaryLyricTrackEvents = trackTextEvents;
          }
        });

        this.state.playback.sequencer = new Sequencer(
          this.state.playback.synthesizer,
        );
        this.state.playback.sequencer.loop = false;
        this.state.playback.synthesizer.setSystemParameter("keyShift", 0);

        bindSpessaEvent(
          this.state.playback.sequencer.eventHandler,
          "songEnded",
          "forte-song-end",
          () => {
            if (this.state.playback.status !== "stopped") this.stopTrack();
          },
        );

        bindSpessaEvent(
          this.state.playback.synthesizer.eventHandler,
          "noteOn",
          "forte-note-on",
          (e) => {
            const isDrum = this.state.playback.synthesizer.midiChannels
              ? (this.state.playback.synthesizer.midiChannels[e.channel]?.preset
                  ?.isGMGSDrum ??
                this.state.playback.synthesizer.midiChannels[e.channel]
                  ?.isDrum ??
                e.channel === 9)
              : e.channel === 9;

            if (!isDrum) {
              if (e.velocity > 0)
                this.state.scoring.activeMidiNotes.add(e.midiNote);
              else this.state.scoring.activeMidiNotes.delete(e.midiNote);
            }
          },
        );

        bindSpessaEvent(
          this.state.playback.synthesizer.eventHandler,
          "noteOff",
          "forte-note-off",
          (e) => {
            const isDrum = this.state.playback.synthesizer.midiChannels
              ? (this.state.playback.synthesizer.midiChannels[e.channel]?.preset
                  ?.isGMGSDrum ??
                this.state.playback.synthesizer.midiChannels[e.channel]
                  ?.isDrum ??
                e.channel === 9)
              : e.channel === 9;

            if (!isDrum) this.state.scoring.activeMidiNotes.delete(e.midiNote);
          },
        );

        let displayableLyricIndex = 0;
        bindSpessaEvent(
          this.state.playback.sequencer.eventHandler,
          "metaEvent",
          "forte-meta",
          (e) => {
            if (this.state.playback.status === "stopped") return;
            if (!e || !e.event) return;

            const dataArray = e.event.data;
            if (!dataArray || !(dataArray instanceof Uint8Array)) return;

            const text = new TextDecoder(
              this.state.playback.lyricsEncoding,
            ).decode(dataArray);
            const cleanText = text.replace(/[\r\n\/\\]/g, "");

            if (cleanText === "@IENCOREDUET") {
              logVerbose("This is a duet");
              document.dispatchEvent(
                new CustomEvent("CherryTree.Forte.Playback.DuetDetected"),
              );
            }

            const trimmedClean = cleanText.trim();
            const isSunplusLyric =
              trimmedClean === "#" ||
              cleanText.startsWith("@m") ||
              cleanText.startsWith("@w");

            if (
              cleanText &&
              (isSunplusLyric ||
                (!cleanText.startsWith("@") && !cleanText.startsWith("#")))
            ) {
              let isVerifiedLyric = false;
              const maxLookahead = Math.min(
                displayableLyricIndex + 5,
                this.state.playback.decodedLyrics.length,
              );

              for (let i = displayableLyricIndex; i < maxLookahead; i++) {
                const expectedClean = this.state.playback.decodedLyrics[
                  i
                ].replace(/[\r\n\/\\]/g, "");
                if (cleanText === expectedClean) {
                  isVerifiedLyric = true;
                  displayableLyricIndex = i;
                  break;
                }
              }

              if (isVerifiedLyric) displayableLyricIndex++;
              else logVerbose("Ignored non-lyric meta event:", cleanText);
            }
          },
        );

        this.state.playback.sequencer.loadNewSongList([parsedMidi]);

        let rawTrackEvents =
          highestLyricScore > 0
            ? primaryLyricTrackEvents
            : parsedMidi.lyrics || [];
        rawTrackEvents.sort((a, b) => a.ticks - b.ticks);

        const totalLength = rawTrackEvents.reduce(
          (acc, val) => acc + (val.data ? val.data.byteLength : 0),
          0,
        );
        const combinedBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const msg of rawTrackEvents) {
          if (msg.data) {
            combinedBuffer.set(msg.data, offset);
            offset += msg.data.byteLength;
          }
        }

        this.state.playback.lyricsEncoding =
          totalLength > 0 ? detectEncoding(combinedBuffer) : "utf-8";
        const decoder = new TextDecoder(this.state.playback.lyricsEncoding);

        const rawLyrics = [];
        this.state.playback.decodedLyrics = [];

        rawTrackEvents.forEach((message) => {
          if (!message.data) return;
          if (
            !parsedMidi.isKaraokeFile &&
            message.statusByte === midiMessageTypes.text
          )
            return;

          const text = decoder.decode(message.data);
          const clean = text.replace(/[\r\n\/\\]/g, "");
          const trimmed = clean.trim();

          if (message.ticks < 480 && trimmed.length > 45) {
            const firstChar = trimmed.charAt(0);
            if (
              firstChar !== "{" &&
              firstChar !== "[" &&
              firstChar !== "<" &&
              firstChar !== "@"
            )
              return;
          }

          let isLyric = false;
          if (
            trimmed === "#" ||
            clean.startsWith("@m") ||
            clean.startsWith("@w")
          )
            isLyric = true;
          else if (!clean.startsWith("@") && !clean.startsWith("#"))
            isLyric = true;

          if (isLyric) {
            rawLyrics.push(message);
            this.state.playback.decodedLyrics.push(
              text.replace(/[\/\\]/g, "\n"),
            );
          }
        });

        this.state.playback.midiInfo = {
          ticks: rawLyrics
            .map((msg) => msg.ticks)
            .filter((t) => t !== undefined),
          timeDivision: parsedMidi.timeDivision || 480,
          tempoChanges: parsedMidi.tempoChanges || [],
          initialBpm:
            parsedMidi.tempoChanges && parsedMidi.tempoChanges.length > 0
              ? Math.round(parsedMidi.tempoChanges[0].tempo || 120)
              : 120,
          keyRange: parsedMidi.keyRange || { min: 0, max: 127 },
        };

        if (rawLyrics.length > 0) {
          const lyricTimes = rawLyrics
            .filter((l) => l.ticks !== undefined)
            .map((l) => parsedMidi.midiTicksToSeconds(l.ticks));

          if (lyricTimes.length > 5) {
            const channels = parsedMidi.getNoteTimes();
            const candidateChannels = [];

            // Choirs, Voice Oohs, Synth Voice / Solo Vox
            // Oboe, Clarinet, Piccolo, Flute, Recorder, Pan Flute, Whistle, Ocarina
            // Square Lead, Saw Wave Lead, Voice Lead
            const highPriorityInstruments = [
              52, 53, 54, 68, 71, 72, 73, 74, 75, 78, 79, 80, 81, 85,
            ];

            // Nylon/Steel Acoustic Guitars (often mock-melody)
            // Muted Trumpet
            // Soprano, Alto, Tenor Saxes
            const medPriorityInstruments = [24, 25, 59, 64, 65, 66];

            // Acoustic, Electric, and Synth Basses
            // String Ensembles / Synth Strings (usually chords/pads)
            const penalizedInstruments = [
              32, 33, 34, 35, 36, 37, 38, 39, 48, 49, 50, 51,
            ];

            for (let i = 0; i < 16; i++) {
              if (i === 9) continue;
              const notes = channels[i];
              if (!notes || notes.length === 0) continue;

              if (notes.length < lyricTimes.length * 0.05) continue;
              if (notes.length > lyricTimes.length * 5) continue;

              let program = 0;
              if (parsedMidi && parsedMidi.tracks) {
                for (const track of parsedMidi.tracks) {
                  const pcEvent = track.events.find(
                    (e) =>
                      (e.statusByte & 0xf0) === 0xc0 &&
                      (e.statusByte & 0x0f) === i,
                  );
                  if (pcEvent && pcEvent.data && pcEvent.data.length > 0) {
                    program = pcEvent.data[0];
                    break;
                  }
                }
              }

              let overlaps = 0;
              let pitchSum = notes[0].midiNote;
              let totalInterval = 0;
              let shortNotes = notes[0].length < 0.25 ? 1 : 0;

              for (let n = 1; n < notes.length; n++) {
                const prevNote = notes[n - 1];
                const prevNoteEnd = prevNote.start + prevNote.length;

                if (notes[n].start < prevNoteEnd - 0.05) overlaps++;

                pitchSum += notes[n].midiNote;
                totalInterval += Math.abs(
                  notes[n].midiNote - prevNote.midiNote,
                );
                if (notes[n].length < 0.25) shortNotes++;
              }

              const polyphonyRatio = overlaps / notes.length;
              if (polyphonyRatio > 0.25) continue;

              const avgInterval = totalInterval / Math.max(1, notes.length - 1);
              const shortNoteRatio = shortNotes / notes.length;

              let matches = 0;
              for (let l = 0; l < lyricTimes.length; l++) {
                const lTime = lyricTimes[l];
                const noteForLyric = notes.find(
                  (n) =>
                    Math.abs(n.start - lTime) < 0.15 ||
                    (n.start <= lTime && n.start + n.length >= lTime + 0.05),
                );
                if (noteForLyric) matches++;
              }

              const matchRatio = matches / lyricTimes.length;
              const densityRatio = notes.length / lyricTimes.length;
              const avgPitch = pitchSum / notes.length;

              let primaryScore = matchRatio * 2.0 - polyphonyRatio * 4.0;

              if (densityRatio > 1.3)
                primaryScore -= (densityRatio - 1.3) * 1.0;
              else if (densityRatio < 0.7)
                primaryScore -= (0.7 - densityRatio) * 1.0;

              let pitchPenalty = 0;
              if (avgPitch < 50) pitchPenalty = (50 - avgPitch) * 0.15;
              if (avgPitch > 85) pitchPenalty = (avgPitch - 85) * 0.15;
              primaryScore -= pitchPenalty;

              if (avgInterval > 3.5) primaryScore -= (avgInterval - 3.5) * 1.5;
              if (shortNoteRatio > 0.8)
                primaryScore -= (shortNoteRatio - 0.8) * 3.0;

              if (i === 3) primaryScore += 0.8;
              else if (i === 4) primaryScore += 0.3;

              if (highPriorityInstruments.includes(program)) {
                primaryScore += 1.0;
              } else if (medPriorityInstruments.includes(program)) {
                primaryScore += 0.4;
              } else if (penalizedInstruments.includes(program)) {
                primaryScore -= 1.5;
              }

              candidateChannels.push({
                index: i,
                notes,
                matchRatio,
                polyphonyRatio,
                avgPitch,
                avgInterval,
                shortNoteRatio,
                program,
                primaryScore,
              });
            }

            candidateChannels.sort((a, b) => b.primaryScore - a.primaryScore);

            if (
              candidateChannels.length > 0 &&
              candidateChannels[0].matchRatio > 0.15
            ) {
              const mainChannel = candidateChannels[0];
              const validChannels = [mainChannel];
              logVerbose(
                `Primary Vocal Guide on Channel ${mainChannel.index + 1} (${mainChannel.program})`,
              );

              for (let i = 1; i < candidateChannels.length; i++) {
                const candidate = candidateChannels[i];

                if (Math.abs(mainChannel.avgPitch - candidate.avgPitch) > 18)
                  continue;

                if (
                  candidate.avgInterval > 4.0 ||
                  candidate.shortNoteRatio > 0.85
                )
                  continue;
                if (penalizedInstruments.includes(candidate.program)) continue;

                const minimumMatches = Math.max(
                  2,
                  Math.floor(lyricTimes.length * 0.03),
                );
                const rawMatches = Math.round(
                  candidate.matchRatio * lyricTimes.length,
                );
                if (rawMatches < minimumMatches) {
                  continue;
                }

                let overlapCount = 0;
                for (const cNote of candidate.notes) {
                  const cEnd = cNote.start + cNote.length;
                  const overlapsMain = mainChannel.notes.some((mNote) => {
                    const mEnd = mNote.start + mNote.length;
                    return (
                      cNote.start < mEnd - 0.05 && cEnd - 0.05 > mNote.start
                    );
                  });

                  if (overlapsMain) overlapCount++;
                }

                if (overlapCount / candidate.notes.length < 0.2) {
                  validChannels.push(candidate);
                  logVerbose(
                    `Secondary Helper Guide found on Channel ${candidate.index + 1} (${candidate.program})`,
                  );
                }
              }

              this.state.playback.guideChannels = validChannels;
              document.dispatchEvent(
                new CustomEvent("CherryTree.Forte.GuideFound"),
              );

              let combinedNotes = [];
              validChannels.forEach((c) => combinedNotes.push(...c.notes));
              combinedNotes.sort((a, b) => a.start - b.start);

              const monoNotes = [];
              let minPitch = 127;
              let maxPitch = 0;

              combinedNotes.forEach((n) => {
                const duration = Math.max(n.length, 0.1);
                const existing = monoNotes.find(
                  (mn) => Math.abs(mn.startTime - n.start) < 0.05,
                );

                if (existing) {
                  if (n.midiNote > existing.pitch) existing.pitch = n.midiNote;
                } else {
                  monoNotes.push({
                    id: monoNotes.length,
                    pitch: n.midiNote,
                    startTime: n.start,
                    duration: duration,
                  });
                }

                if (n.midiNote < minPitch) minPitch = n.midiNote;
                if (n.midiNote > maxPitch) maxPitch = n.midiNote;
              });

              monoNotes.sort((a, b) => a.startTime - b.startTime);

              let shortNoteCount = 0;
              for (const note of monoNotes)
                if (note.duration <= 0.2) shortNoteCount++;

              if (
                monoNotes.length > 0 &&
                shortNoteCount / monoNotes.length > 0.5
              ) {
                for (let i = 0; i < monoNotes.length; i++) {
                  const currentNote = monoNotes[i];
                  const nextNote = monoNotes[i + 1];
                  if (nextNote) {
                    const timeToNext =
                      nextNote.startTime - currentNote.startTime;
                    if (timeToNext > 0 && timeToNext < 2.5) {
                      currentNote.duration = Math.max(
                        currentNote.duration,
                        timeToNext - 0.05,
                      );
                    } else if (timeToNext >= 2.5) {
                      currentNote.duration = Math.max(
                        currentNote.duration,
                        0.75,
                      );
                    }
                  } else {
                    currentNote.duration = Math.max(currentNote.duration, 1.0);
                  }
                }
              } else {
                for (let i = 0; i < monoNotes.length; i++) {
                  const currentNote = monoNotes[i];
                  if (currentNote.duration < 0.2) {
                    const timeToNext = monoNotes[i + 1]
                      ? monoNotes[i + 1].startTime - currentNote.startTime
                      : 1.0;
                    currentNote.duration = Math.max(
                      currentNote.duration,
                      Math.min(0.2, timeToNext - 0.01),
                    );
                  }
                }
              }

              this.state.playback.guideNotes = monoNotes;
              this.state.playback.guideRange = {
                min: Math.max(0, minPitch - 4),
                max: Math.min(127, maxPitch + 4),
              };
            }
          }
        }
        this.state.playback.buffer = null;
      } else {
        this.state.playback.buffer =
          await this.audioCore.context.decodeAudioData(arrayBuffer);
        if (this.state.playback.isMultiplexed) {
          this.startIncrementalGuideAnalysis(this.state.playback.buffer);
        }
      }

      this.state.playback.status = "stopped";
      this.state.playback.pauseTime = 0;
      logVerbose(`Track loaded: ${url}`);
      this.dispatchUpdate();
      return true;
    } catch (e) {
      console.error(`[FORTE SVC] Failed to load track: ${url}`, e);
      return false;
    }
  }

  /**
   * Executes loaded node timelines beginning progression logic and sound routing.
   */
  playTrack() {
    if (this.audioCore.context.state === "suspended")
      this.audioCore.context.resume();

    if (this.state.recording.destinationNode) {
      this.state.recording.trackDelayNode =
        this.audioCore.context.createDelay();
      const recordingGain = this.audioCore.context.createGain();
      recordingGain.gain.value = this.state.effects.musicGainInRecording;

      this.state.recording.musicRecordingGainNode = recordingGain;
      this.state.recording.trackDelayNode.delayTime.value =
        this.state.scoring.measuredLatencyS;

      this.state.recording.trackDelayNode.connect(recordingGain);
      recordingGain.connect(this.state.recording.destinationNode);
      recordingGain.connect(this.state.recording.musicDestinationNode);
    }

    this.state.scoring.enabled = true;

    Object.assign(this.state.scoring, {
      finalScore: 0,
      totalScorableNotes: 0,
      notesHit: 0,
      micPitchHistory: [],
      singingGraceFrames: 0,
      smoothedMicMidi: 0,
      currentOctaveOffset: 0,
      wasVisuallySinging: false,
      isVocalGuideNoteActive: false,
      hasHitCurrentNote: false,
      totalFramesSinging: 0,
      framesInKey: 0,
      rollingChroma: new Array(12).fill(0),
      currentKeyName: null,
      allowedPitchClasses: [],
      keyHistory: [],
      frameCount: 0,
      activeMidiNotes: new Set(),
      details: { accuracy: 0 },
    });

    if (this.state.playback.isMidi) {
      if (
        !this.state.playback.sequencer ||
        this.state.playback.status === "playing"
      )
        return;

      if (this.state.recording.trackDelayNode && this.state.playback.midiGain) {
        this.state.playback.midiGain.connect(
          this.state.recording.trackDelayNode,
        );
      }

      if (
        this.state.playback.guideNotes &&
        this.state.playback.guideNotes.length > 0
      ) {
        this.pianoRoll.toggleVisibility(true);
      }

      this.state.playback.sequencer.currentTime = 0;
      this.state.playback.sequencer.play();
      this.state.playback.status = "playing";
    } else {
      if (
        !this.state.playback.buffer ||
        this.state.playback.status === "playing"
      )
        return;

      this.sourceNode = this.audioCore.context.createBufferSource();
      this.sourceNode.buffer = this.state.playback.buffer;
      this.sourceNode.playbackRate.value = Math.pow(
        2,
        this.state.playback.transpose / 12,
      );

      if (
        this.state.playback.guideNotes &&
        this.state.playback.guideNotes.length > 0
      ) {
        this.pianoRoll.toggleVisibility(true);
      }

      if (this.state.playback.isMultiplexed) {
        const vocalGuideAnalyser = this.audioCore.context.createAnalyser();
        vocalGuideAnalyser.fftSize = 2048;
        this.state.scoring.vocalGuideAnalyser = vocalGuideAnalyser;

        const delayNode = this.audioCore.context.createDelay();
        delayNode.delayTime.value = this.state.scoring.measuredLatencyS;
        this.state.scoring.guideVocalDelayNode = delayNode;

        const splitter = this.audioCore.context.createChannelSplitter(2);
        const leftGain = this.audioCore.context.createGain();
        const rightGain = this.audioCore.context.createGain();
        const monoMixer = this.audioCore.context.createGain();

        this.state.playback.leftPannerGain = leftGain;
        this.state.playback.rightPannerGain = rightGain;

        this.sourceNode.connect(splitter);
        splitter.connect(leftGain, 0); // Instrument
        splitter.connect(rightGain, 1); // Vocals
        splitter.connect(delayNode, 1); // Delay vocals for guide analyzer
        delayNode.connect(vocalGuideAnalyser);

        leftGain.connect(monoMixer);
        rightGain.connect(monoMixer);
        monoMixer.connect(this.audioCore.masterGain);

        if (this.state.recording.trackDelayNode) {
          splitter.connect(this.state.recording.trackDelayNode, 0);
        }
        this.setMultiplexPan(this.state.playback.multiplexPan);
      } else {
        this.sourceNode.connect(this.audioCore.masterGain);
        this.sourceNode.connect(this.state.scoring.musicAnalyser);

        if (this.state.recording.trackDelayNode) {
          this.sourceNode.connect(this.state.recording.trackDelayNode);
        }
      }

      this.sourceNode.onended = () => {
        if (this.state.playback.status === "playing") this.stopTrack();
      };

      this.sourceNode.start(0, this.state.playback.pauseTime);
      this.state.playback.startTime = this.audioCore.context.currentTime;
      this.state.playback.status = "playing";
    }

    if (
      !this.state.playback.isMidi &&
      !this.state.playback.isMultiplexed &&
      this.state.playback.buffer
    ) {
      if (typeof Meyda !== "undefined") {
        if (!this.state.scoring.meydaAnalyzer) {
          this.state.scoring.meydaAnalyzer = Meyda.createMeydaAnalyzer({
            audioContext: this.audioCore.context,
            source: this.state.scoring.musicAnalyser,
            bufferSize: 2048,
            featureExtractors: ["chroma"],
          });
        }
        this.state.scoring.meydaAnalyzer.start();
      }
    }

    this.dispatchUpdate();
    this.state.playback.lastFrameTime = performance.now();
    this.state.playback.smoothedTime = this.getPlaybackState().currentTime;

    if (this.animationFrameId === null) this.timingLoop();
  }

  /**
   * Briefly pauses track play preserving position counters and visual graphs.
   */
  pauseTrack() {
    if (this.state.playback.status !== "playing") return;

    this.state.scoring.enabled = false;
    this.pianoRoll.toggleVisibility(false);

    if (this.state.scoring.meydaAnalyzer)
      this.state.scoring.meydaAnalyzer.stop();

    if (this.state.recording.trackDelayNode) {
      this.state.recording.trackDelayNode.disconnect();
      if (this.state.playback.isMidi && this.state.playback.midiGain) {
        try {
          this.state.playback.midiGain.disconnect(
            this.state.recording.trackDelayNode,
          );
        } catch (e) {}
      }
      this.state.recording.trackDelayNode = null;
    }

    if (this.state.playback.isMidi) {
      if (this.state.playback.sequencer) {
        try {
          this.state.playback.sequencer.pause();
        } catch (e) {}
      }
      this.state.playback.status = "paused";
    } else {
      if (!this.sourceNode) return;
      const rate = this.sourceNode.playbackRate.value;
      const elapsed =
        this.audioCore.context.currentTime - this.state.playback.startTime;
      this.state.playback.pauseTime += elapsed * rate;
      this.sourceNode.stop();
      this.state.playback.leftPannerGain = null;
      this.state.playback.rightPannerGain = null;
      this.state.playback.status = "paused";
      this.sourceNode = null;
    }

    this.dispatchUpdate();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Ends track and resets active properties, wiping buffers and hiding tools.
   */
  stopTrack() {
    this.pianoRoll.toggleVisibility(false);

    if (this.state.playback.status === "stopped") return;
    this.state.playback.status = "stopped";

    if (this.state.scoring.meydaAnalyzer)
      this.state.scoring.meydaAnalyzer.stop();

    if (this.state.recording.trackDelayNode) {
      this.state.recording.trackDelayNode.disconnect();
      if (this.state.playback.isMidi && this.state.playback.midiGain) {
        try {
          this.state.playback.midiGain.disconnect(
            this.state.recording.trackDelayNode,
          );
        } catch (e) {}
      }
      this.state.recording.trackDelayNode = null;
    }

    if (this.state.playback.isMidi) {
      this.state.playback.synthesizer.setSystemParameter("keyShift", 0);
      if (this.state.playback.sequencer) {
        try {
          this.state.playback.sequencer.pause();
        } catch (e) {}
        try {
          this.state.playback.sequencer.currentTime = 0;
        } catch (e) {}
      }
    } else {
      if (this.sourceNode) {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode = null;
      }
    }

    this.state.playback.leftPannerGain = null;
    this.state.playback.rightPannerGain = null;
    this.state.playback.multiplexPan = -1;
    this.state.playback.pauseTime = 0;

    this.dispatchUpdate();

    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Controls individual gain levels filtering split multiplex nodes pushing output toward specific sides.
   *
   * @param {number} panValue - Number mapped from -1 (Left/Inst) to 1 (Right/Vocal).
   */
  setMultiplexPan(panValue) {
    const pan = Math.max(-1, Math.min(1, panValue));
    this.state.playback.multiplexPan = pan;

    const { leftPannerGain, rightPannerGain } = this.state.playback;
    if (leftPannerGain && rightPannerGain) {
      leftPannerGain.gain.setValueAtTime(
        (1 - pan) / 2,
        this.audioCore.context.currentTime,
      );
      rightPannerGain.gain.setValueAtTime(
        (1 + pan) / 2,
        this.audioCore.context.currentTime,
      );
    }
    this.dispatchUpdate();
  }

  /**
   * Alters structural playback properties scaling raw audio streams up and down or stepping SpessaSynth MIDI pitch.
   *
   * @param {number} semitones - Increment specifying half-step directionations.
   */
  setTranspose(semitones) {
    const clamped = Math.max(-24, Math.min(24, Math.round(semitones)));
    const transposeDelta = clamped - this.state.playback.transpose;

    if (transposeDelta !== 0) {
      this.state.scoring.rollingChroma.fill(0);
      this.state.scoring.keyHistory = [];
      if (this.state.scoring.allowedPitchClasses.length > 0) {
        this.state.scoring.allowedPitchClasses =
          this.state.scoring.allowedPitchClasses.map(
            (pc) => (pc + transposeDelta + 24) % 12,
          );
      }
    }

    if (
      !this.state.playback.isMidi &&
      this.state.playback.status === "playing" &&
      this.sourceNode
    ) {
      const rate = this.sourceNode.playbackRate.value;
      const elapsed =
        this.audioCore.context.currentTime - this.state.playback.startTime;
      this.state.playback.pauseTime += elapsed * rate;
      this.state.playback.startTime = this.audioCore.context.currentTime;
    }

    this.state.playback.transpose = clamped;

    if (this.state.playback.isMidi && this.state.playback.synthesizer) {
      this.state.playback.synthesizer.setSystemParameter("keyShift", clamped);
    } else if (!this.state.playback.isMidi && this.sourceNode) {
      this.sourceNode.playbackRate.setValueAtTime(
        Math.pow(2, clamped / 12),
        this.audioCore.context.currentTime,
      );
    }

    this.dispatchUpdate();
  }

  /**
   * Modifies the individual track volume of the MIDI channels containing the guide melody.
   *
   * @param {number} volume - Volume mapping value (0-127).
   */
  setGuideTrackVolume(volume) {
    const applyVolumeToGuide = async () => {
      const snapshot = await this.state.playback.synthesizer.getSnapshot();
      for (const ch of this.state.playback.guideChannels) {
        const channelSnapshot = snapshot.midiChannels?.[ch.index];
        const expressionValue = channelSnapshot.midiControllers[11];
        const actualExpression = expressionValue >> 7;
        if (actualExpression < 1) {
          this.synthesizer.setChannelExpression(ch.index, 127);
        }
        this.synthesizer.setChannelVolume(ch.index, volume);
      }
    };

    const scheduleApply = () => {
      clearTimeout(this.guideVolumeSwitchTimeout);
      this.guideVolumeSwitchTimeout = setTimeout(() => {
        if (this.state.playback.guideChannels.length < 1) {
          document.addEventListener(
            "CherryTree.Forte.GuideFound",
            applyVolumeToGuide,
            { once: true },
          );
          return;
        }
        applyVolumeToGuide();
      }, 50);
    };

    if (this.state.playback.status === "playing") {
      scheduleApply();
      return;
    }

    document.removeEventListener(
      "CherryTree.Forte.Playback.Update",
      scheduleApply,
    );
    document.addEventListener(
      "CherryTree.Forte.Playback.Update",
      scheduleApply,
      { once: true },
    );
  }

  /**
   * Assembles all metadata properties currently framing active media tracks output.
   *
   * @returns {Object} Representation of engine time properties and statuses.
   */
  getPlaybackState() {
    let duration = 0;
    let currentTime = 0;

    if (this.state.playback.isMidi && this.state.playback.sequencer) {
      duration = this.state.playback.sequencer.duration || 0;
      currentTime = this.state.playback.sequencer.currentTime || 0;
    } else if (this.state.playback.buffer) {
      duration = this.state.playback.buffer.duration;
      if (this.state.playback.status === "playing" && this.sourceNode) {
        const rate = this.sourceNode.playbackRate.value;
        const elapsed =
          this.audioCore.context.currentTime - this.state.playback.startTime;
        currentTime = this.state.playback.pauseTime + elapsed * rate;
      } else {
        currentTime = this.state.playback.pauseTime;
      }
    }

    return {
      status: this.state.playback.status,
      currentTime: Math.min(currentTime, duration),
      duration,
      currentDeviceId: this.state.playback.currentDeviceId,
      isMidi: this.state.playback.isMidi,
      isMultiplexed: this.state.playback.isMultiplexed,
      hasGuideNotes:
        this.state.playback.guideNotes &&
        this.state.playback.guideNotes.length > 0,
      decodedLyrics: this.state.playback.decodedLyrics,
      midiInfo: this.state.playback.midiInfo,
      transpose: this.state.playback.transpose,
      multiplexPan: this.state.playback.multiplexPan,
      score: this.scoring.getScoringState(),
    };
  }

  /**
   * Disconnects nodes cutting streams.
   */
  cleanup() {
    this.stopTrack();
  }
}
