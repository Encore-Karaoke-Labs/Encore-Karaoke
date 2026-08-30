import Romanizer from "../../../modules/Romanizer.js";

const INTERLUDE_TIPS = [
  "TIP: You can use your phone to queue songs by scanning the QR code!",
  "Take a deep breath and get ready for the next verse.",
  "”Maybe there's only a dark road up ahead. But you still have to believe and keep going. Believe that the stars will light your path, even a little bit.” - Kaori Miyazono, Your Lie in April",
  "”Music speaks louder than words” - Kousei Arima, Your Lie in April",
  "Grab a drink and rest your vocal cords.",
  "”Rock resonates as the music of the perpetual underdog. Is it really rock if it's sung by life's winners?” - Hitori Gotoh, Bocchi The Rock!",
  "TIP: You can search for songs by title, artist, or song number by pressing Y.",
  "TIP: Press F2 to enter the setup menu in the Main Menu.",
  "TIP: Adjust the instrumental volume using the - and = keys.",
];

const EXPERIMENTAL_INTERLUDES = [
  "”Get freaky 🤑🤑” - Stariix, Encore Karaoke Labs",
  "”it had to wait 9 months” - Austin, Encore Karaoke Labs\n”Who's the mother? Electron Forge” - Austin, Encore Karaoke Labs\n”It's a girl! Who's the father? SkySorcerer!” - ”Dave”, Encore Karaoke Labs\n”ok 'dave'” - SkySorcerer, Founder @ Encore Karaoke Labs",
];

export default class LyricsEngine {
  /**
   * @param {Object} context - The shared context
   */
  constructor(context) {
    this.ctx = context;

    if (this.ctx.state.isEasterEggInterludeEnabled) {
      console.log("ooo freaky 🤪");
      INTERLUDE_TIPS.push(EXPERIMENTAL_INTERLUDES);
    }

    this.asianRegex =
      /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
    this.tempTips = structuredClone(INTERLUDE_TIPS);

    this.lyricsCtx = null;
    this.lyricsRafId = null;
    this.boundTimeUpdate = null;
    this.nextLineUpdateTimeout = null;

    this.romajiCache = {};
    this.pendingRomajiFetches = new Set();

    this.lineCaches = [];
    for (let i = 0; i < 2; i++) {
      const dim = document.createElement("canvas");
      const main = document.createElement("canvas");
      this.lineCaches.push({
        dim,
        dimCtx: dim.getContext("2d", { alpha: true }),
        main,
        mainCtx: main.getContext("2d", { alpha: true }),
      });
    }

    this.requestCanvasCacheUpdate = false;

    this.parsedLrc = [];
    this.interludes = [];
    this.countdowns = [];
    this.allMidiSyllables = [];
    this.renderableLines = [];
    this.midiLines = null;
    this.currentSongLineIndex = 0;

    this.currentMediaTime = 0;
    this.lastMediaTimeUpdate = null;

    this.resizeLyricsCanvas = this.resizeLyricsCanvas.bind(this);
    window.addEventListener("resize", this.resizeLyricsCanvas);
  }

  init() {
    const canvas = this.ctx.dom.lyricsCanvas.elm;
    this.lyricsCtx = canvas.getContext("2d", { alpha: true });
    this.resizeLyricsCanvas();
  }

  reset() {
    this.cleanupEvents();
    this.currentSongLineIndex = 0;

    this.romajiCache = {};
    this.pendingRomajiFetches = new Set();

    this.ctx.dom.countdownDisplay.classOff("visible").text("");
    this.lastCountdownTick = null;

    if (this.lyricsRafId) cancelAnimationFrame(this.lyricsRafId);
    if (this.lyricsCtx) {
      this.lyricsCtx.save();
      this.lyricsCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.lyricsCtx.clearRect(
        0,
        0,
        this.ctx.dom.lyricsCanvas.elm.width,
        this.ctx.dom.lyricsCanvas.elm.height,
      );
      this.lyricsCtx.restore();
    }

    this.renderableLines = [];
    this.currentMidiLine1 = [];
    this.currentMidiLine2 = [];
    this.currentLrcLine1 = null;
    this.currentLrcLine2 = null;
    this.midiLines = null;
    this.allMidiSyllables = null;
    this.parsedLrc = [];
    this.interludes = [];
    this.countdowns = [];
  }

  cleanupEvents() {
    if (this.nextLineUpdateTimeout) clearTimeout(this.nextLineUpdateTimeout);
    this.nextLineUpdateTimeout = null;

    if (this.boundTimeUpdate)
      document.removeEventListener(
        "CherryTree.Forte.Playback.TimeUpdate",
        this.boundTimeUpdate,
      );

    this.boundTimeUpdate = null;
  }

  resizeLyricsCanvas() {
    if (!this.ctx.dom.lyricsCanvas) return;
    const canvas = this.ctx.dom.lyricsCanvas.elm;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.min(window.innerWidth * 0.9, 1400);

    const logicalWidth = width;
    const mainFontSize = Math.floor(logicalWidth * 0.045);
    const fixedHeight = Math.max(250, mainFontSize * 10);

    this.logicalWidth = logicalWidth;
    this.logicalHeight = fixedHeight;

    canvas.width = width * dpr;
    canvas.height = fixedHeight * dpr;
    this.ctx.dom.lyricsCanvas.styleJs({
      width: `${width}px`,
      height: `${fixedHeight}px`,
    });

    if (this.lyricsCtx) {
      this.lyricsCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.lyricsCtx.scale(dpr, dpr);
    }

    this.requestCanvasCacheUpdate = true;
    if (this.ctx.state.mode === "player") this.calculateLyricLayout();
  }

  getDuetColors(role) {
    const colors = {
      f: {
        main: "#ffff33",
        stroke: "#665200",
        dim: "rgba(255, 255, 51, 0.35)",
        dimStroke: "rgba(102, 82, 0, 0.6)",
        ruby: {
          main: "#fffefa",
          stroke: "#594700",
          dim: "rgba(255, 255, 180, 0.35)",
          dimStroke: "rgba(89, 71, 0, 0.5)",
        },
        romaji: {
          text: "rgba(255, 255, 170, 0.85)",
          stroke: "rgba(60, 45, 0, 0.85)",
        },
      },
      f2: {
        main: "#66ff66",
        stroke: "#004d00",
        dim: "rgba(102, 255, 102, 0.35)",
        dimStroke: "rgba(0, 77, 0, 0.6)",
        ruby: {
          main: "#eafeea",
          stroke: "#003800",
          dim: "rgba(180, 255, 180, 0.35)",
          dimStroke: "rgba(0, 56, 0, 0.5)",
        },
        romaji: {
          text: "rgba(180, 255, 180, 0.85)",
          stroke: "rgba(0, 40, 0, 0.85)",
        },
      },
      m: {
        main: "#66e6ff",
        stroke: "#004d66",
        dim: "rgba(102, 230, 255, 0.35)",
        dimStroke: "rgba(0, 77, 102, 0.6)",
        ruby: {
          main: "#e6faff",
          stroke: "#00364d",
          dim: "rgba(180, 240, 255, 0.35)",
          dimStroke: "rgba(0, 54, 77, 0.5)",
        },
        romaji: {
          text: "rgba(180, 242, 255, 0.85)",
          stroke: "rgba(0, 45, 60, 0.85)",
        },
      },
      m2: {
        main: "#ff6666",
        stroke: "#660000",
        dim: "rgba(255, 102, 102, 0.35)",
        dimStroke: "rgba(102, 0, 0, 0.6)",
        ruby: {
          main: "#ffe6e6",
          stroke: "#4d0000",
          dim: "rgba(255, 180, 180, 0.35)",
          dimStroke: "rgba(77, 0, 0, 0.5)",
        },
        romaji: {
          text: "rgba(255, 180, 180, 0.85)",
          stroke: "rgba(60, 0, 0, 0.85)",
        },
      },
      a: {
        main: "#ffb233",
        stroke: "#804000",
        dim: "rgba(255, 178, 51, 0.35)",
        dimStroke: "rgba(128, 64, 0, 0.6)",
        ruby: {
          main: "#fff2e6",
          stroke: "#663300",
          dim: "rgba(255, 210, 150, 0.35)",
          dimStroke: "rgba(102, 51, 0, 0.5)",
        },
        romaji: {
          text: "rgba(255, 215, 160, 0.85)",
          stroke: "rgba(70, 35, 0, 0.85)",
        },
      },
      default: {
        main: "#ffffff",
        stroke: "#010141",
        dim: "rgba(255, 255, 255, 0.4)",
        dimStroke: "rgba(1, 1, 65, 0.6)",
        ruby: {
          main: "#f2f2ff",
          stroke: "#01012b",
          dim: "rgba(230, 230, 255, 0.35)",
          dimStroke: "rgba(1, 1, 45, 0.5)",
        },
        romaji: {
          text: "rgba(235, 238, 255, 0.88)",
          stroke: "rgba(5, 5, 45, 0.85)",
        },
      },
    };
    return colors[role] || colors["default"];
  }

  async setupLyrics(song, pbState) {
    this.reset();
    const dom = this.ctx.dom;

    let cachedTempoChanges = null;

    const getSecondsForTick = (targetTick, tempoChanges, ppqm) => {
      if (targetTick <= 0) return 0;
      let time = 0,
        currentTick = 0,
        currentBpm = 120;

      if (!cachedTempoChanges) {
        if (tempoChanges && tempoChanges.length > 0) {
          cachedTempoChanges = tempoChanges
            .map((tc, index) => {
              let tick = tc.ticks !== undefined ? tc.ticks : tc.tick;
              let val = tc.tempo || tc.bpm || 120;
              let bpm = val > 1000 ? Math.round(60000000 / val) : val;
              if (bpm <= 0) bpm = 120;
              return { tick, bpm, _originalIndex: index };
            })
            .sort((a, b) =>
              a.tick !== b.tick
                ? a.tick - b.tick
                : b._originalIndex - a._originalIndex,
            );
        } else {
          cachedTempoChanges = [];
        }
      }

      if (cachedTempoChanges.length > 0) {
        for (let tc of cachedTempoChanges) {
          if (tc.tick >= targetTick) break;
          if (tc.tick > currentTick) {
            time += ((tc.tick - currentTick) / ppqm) * (60 / currentBpm);
            currentTick = tc.tick;
          }
          currentBpm = tc.bpm;
        }
      }

      let remainingTicks = targetTick - currentTick;
      if (remainingTicks > 0)
        time += (remainingTicks / ppqm) * (60 / currentBpm);
      return time;
    };

    if (pbState.isMidi) {
      dom.lyricsCanvas.styleJs({ display: "block" });
      const midiInfo = pbState.midiInfo;
      let ppqm = midiInfo.timeDivision || 480;
      let lyricsToParse = [...pbState.decodedLyrics];

      let displayBpm = 120;
      if (midiInfo.tempoChanges && midiInfo.tempoChanges.length > 0) {
        let initialChanges = midiInfo.tempoChanges.filter(
          (t) => (t.ticks !== undefined ? t.ticks : t.tick) === 0,
        );
        let firstTc =
          initialChanges.length > 0
            ? initialChanges[0]
            : midiInfo.tempoChanges[0];
        let val = firstTc.tempo || firstTc.bpm || 120;
        displayBpm = val > 1000 ? Math.round(60000000 / val) : Math.round(val);
      }
      dom.introMeta.text(`BPM: ${displayBpm}`);

      let fullMetadataString = "";
      while (
        lyricsToParse.length > 0 &&
        (lyricsToParse[0].trim().startsWith("{@") ||
          lyricsToParse[0].trim().startsWith("{#"))
      ) {
        fullMetadataString += lyricsToParse.shift();
      }

      if (fullMetadataString) {
        const metadata = {};
        const regex = /{#([^=]+)=([^}]+)}/g;
        let match;
        while ((match = regex.exec(fullMetadataString)) !== null)
          metadata[match[1].toUpperCase()] = match[2];
        if (metadata.TITLE)
          dom.introTitle.text(
            this.ctx.root.playback.truncateTitleIfNeeded(metadata.TITLE),
          );
        if (metadata.ARTIST) dom.introArtist.text(metadata.ARTIST);
      }

      const allSyllables = [];
      const lines = [];
      let currentLineSyllables = [];
      let displayableSyllableIndex = 0;
      let offsetIndex = pbState.decodedLyrics.length - lyricsToParse.length;

      let currentDuetRole = "a";
      let sunplusHashtagGroup = [];
      let hasSunplusCountdowns = false;

      for (let i = 0; i < lyricsToParse.length; i++) {
        const syllableText = lyricsToParse[i];
        const tick = midiInfo.ticks[i + offsetIndex];
        const absoluteTime = getSecondsForTick(
          tick,
          midiInfo.tempoChanges,
          ppqm,
        );

        const startsWithNewLine = /^[\r\n\/\\\\]/.test(syllableText);
        const endsWithNewLine = /[\r\n\/\\\\]$/.test(syllableText);
        let cleanText = syllableText.replace(/[\r\n\/\\]/g, "");
        let displayText = cleanText;

        const sunplusMatch = displayText.match(/^@(m|w)/i);
        if (sunplusMatch) {
          currentDuetRole = sunplusMatch[1].toLowerCase() === "w" ? "f" : "m";
          displayText = displayText.substring(sunplusMatch[0].length);
        }

        let isSunplusCountdown = false;
        if (displayText.trim() === "#") {
          sunplusHashtagGroup.push(absoluteTime);
          hasSunplusCountdowns = true;
          continue;
        }

        if (sunplusHashtagGroup.length > 0) {
          const len = sunplusHashtagGroup.length;
          this.countdowns.push({
            t3:
              len >= 4
                ? sunplusHashtagGroup[len - 4]
                : len === 3
                  ? sunplusHashtagGroup[0]
                  : 0,
            t2:
              len >= 3
                ? sunplusHashtagGroup[len - 3]
                : len === 2
                  ? sunplusHashtagGroup[0]
                  : 0,
            t1:
              len >= 2
                ? sunplusHashtagGroup[len - 2]
                : sunplusHashtagGroup[len - 1],
            t0: absoluteTime,
          });
          sunplusHashtagGroup = [];
        }

        const markerMatch = displayText.match(/\[(m|f|m2|f2|a)\]/g);
        if (markerMatch) {
          currentDuetRole = markerMatch[markerMatch.length - 1].replace(
            /[\[\]]/g,
            "",
          );
          displayText = displayText.replace(/\[(m|f|m2|f2|a)\]/g, "");
        }

        if (startsWithNewLine && currentLineSyllables.length > 0) {
          lines.push(currentLineSyllables);
          currentLineSyllables = [];
        }

        if (cleanText) {
          let mainText = displayText,
            furiganaText = null;
          if (displayText) {
            const furiMatch = displayText.match(/^(.+?)\[(.+?)\]$/);
            if (furiMatch) {
              mainText = furiMatch[1];
              furiganaText = furiMatch[2];
            }
          }
          const syllable = {
            text: mainText,
            furigana: furiganaText,
            rawText: cleanText,
            displayText: displayText,
            globalIndex: displayableSyllableIndex,
            lineIndex: lines.length,
            tick: tick,
            absoluteTime: absoluteTime,
            durationTicks: 0,
            duetRole: currentDuetRole,
            isHidden: displayText.length === 0 || isSunplusCountdown,
          };
          allSyllables.push(syllable);
          if (!isSunplusCountdown) currentLineSyllables.push(syllable);
          displayableSyllableIndex++;
        }
        if (endsWithNewLine && cleanText && currentLineSyllables.length > 0) {
          lines.push(currentLineSyllables);
          currentLineSyllables = [];
        }
      }
      if (currentLineSyllables.length > 0) lines.push(currentLineSyllables);

      if (
        !hasSunplusCountdowns &&
        allSyllables.length > 0 &&
        allSyllables[0].tick >= 8 * ppqm
      ) {
        let nTick = allSyllables[0].tick;
        this.countdowns.push({
          t3: getSecondsForTick(nTick - 3 * ppqm, midiInfo.tempoChanges, ppqm),
          t2: getSecondsForTick(nTick - 2 * ppqm, midiInfo.tempoChanges, ppqm),
          t1: getSecondsForTick(nTick - 1 * ppqm, midiInfo.tempoChanges, ppqm),
          t0: getSecondsForTick(nTick, midiInfo.tempoChanges, ppqm),
        });
      }

      for (let i = 0; i < allSyllables.length - 1; i++) {
        let cur = allSyllables[i],
          next = allSyllables[i + 1];
        cur.durationTicks = Math.max(0, next.tick - cur.tick);
        let gapTicks = next.tick - cur.tick;
        cur.endTime = getSecondsForTick(
          cur.tick + cur.durationTicks,
          midiInfo.tempoChanges,
          ppqm,
        );
        if (cur.rawText.match(/[\r\n\/\\]$/)) {
          const beatDuration =
            getSecondsForTick(cur.tick + ppqm, midiInfo.tempoChanges, ppqm) -
            cur.absoluteTime;
          cur.endTime = Math.min(cur.endTime, cur.absoluteTime + beatDuration);
        }
        cur.endTime = Math.min(cur.endTime, cur.absoluteTime + 1.5);

        if (gapTicks >= 8 * ppqm && cur.lineIndex !== next.lineIndex) {
          let intStart = cur.tick + 2 * ppqm,
            intEnd = next.tick - 4 * ppqm;
          let calculatedStart = getSecondsForTick(
            intStart,
            midiInfo.tempoChanges,
            ppqm,
          );
          let calculatedEnd = getSecondsForTick(
            intEnd,
            midiInfo.tempoChanges,
            ppqm,
          );
          calculatedStart = Math.max(cur.endTime + 0.1, calculatedStart);

          if (
            calculatedStart < calculatedEnd &&
            calculatedEnd - calculatedStart >= 4.0
          ) {
            this.interludes.push({
              start: calculatedStart,
              end: calculatedEnd,
            });

            if (!hasSunplusCountdowns) {
              this.countdowns.push({
                t3: getSecondsForTick(
                  next.tick - 3 * ppqm,
                  midiInfo.tempoChanges,
                  ppqm,
                ),
                t2: getSecondsForTick(
                  next.tick - 2 * ppqm,
                  midiInfo.tempoChanges,
                  ppqm,
                ),
                t1: getSecondsForTick(
                  next.tick - 1 * ppqm,
                  midiInfo.tempoChanges,
                  ppqm,
                ),
                t0: getSecondsForTick(next.tick, midiInfo.tempoChanges, ppqm),
              });
            }
          }
        }
      }
      if (allSyllables.length > 0) {
        let last = allSyllables[allSyllables.length - 1];
        last.durationTicks = ppqm;
        const beatDuration =
          getSecondsForTick(last.tick + ppqm, midiInfo.tempoChanges, ppqm) -
          last.absoluteTime;
        last.endTime = last.absoluteTime + Math.min(beatDuration, 1.5);
      }

      this.currentPpqm = ppqm;
      this.allMidiSyllables = allSyllables;
      this.midiLines = lines;
      this.currentMidiLine1 = this.midiLines[0] || [];
      this.currentMidiLine2 = this.midiLines[1] || [];

      this._resolveRomajiForLine(0);
      this._resolveRomajiForLine(1);
      this._resolveRomajiForLine(2);

      this.resizeLyricsCanvas();
      dom.lyricsCanvas.styleJs({ opacity: "1" });

      this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
    } else if (song.lrcPath) {
      const lrcText = await this.ctx.services.FsSvc.readFile(song.lrcPath);
      this.parsedLrc = await this.parseLrc(lrcText);

      if (this.parsedLrc.length > 0) {
        for (let i = 0; i < this.parsedLrc.length; i++) {
          let line = this.parsedLrc[i];
          let needsRomaji = this.asianRegex.test(line.text);
          let syllables = [];

          let chunks = [];
          if (!needsRomaji) {
            chunks = line.text.match(/\S+\s*/g) || [line.text];
          } else {
            if (line.text.match(/[ 　]/)) {
              chunks = line.text.match(/[^ 　]+[ 　]*/g) || [line.text];
            } else if (line.text.length > 16) {
              let puncChunks = line.text.match(/[^、。！？]+[、。！？]*/g) || [
                line.text,
              ];
              for (let c of puncChunks) {
                if (c.length > 16) chunks.push(...(c.match(/.{1,12}/g) || [c]));
                else chunks.push(c);
              }
            } else {
              chunks = [line.text];
            }
          }

          for (let chunk of chunks) {
            const trimmed = chunk.trim();
            syllables.push({
              text: chunk,
              rawText: chunk,
              furigana: null,
              blockWidth: 0,
              absoluteTime: line.time,
              endTime: line.time + 1,
              durationTicks: 0,
              duetRole: "default",
              isHidden: trimmed === "",
            });
          }
          line.syllables = syllables;
        }
        this.currentLrcLine1 = this.parsedLrc[0];
        this.currentLrcLine2 = this.parsedLrc[1];
        this.isLrcLine2Active = false;
        this.currentLrcIndex = -1;
        this.lrcChangeTime = 0;

        this.nextLineFadeStartMs = performance.now();
        this.nextLineFadeDurationMs = 500;

        this.resizeLyricsCanvas();
        dom.lyricsCanvas.styleJs({ opacity: "1" });
        this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());

        if (this.parsedLrc[0].time > 4.0)
          this.countdowns.push(this.parsedLrc[0].time);
        for (let i = 0; i < this.parsedLrc.length - 1; i++) {
          let cur = this.parsedLrc[i],
            next = this.parsedLrc[i + 1];
          if (next.time - cur.time > 8.0) this.countdowns.push(next.time);
        }
      }
    }
  }

  async parseLrc(text) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    if (!text) return [];
    const lines = text.split("\n");
    const promises = lines.map(async (line) => {
      const match = line.match(regex);
      if (!match) return null;
      const time =
        parseInt(match[1]) * 60 +
        parseInt(match[2]) +
        parseInt(match[3].padEnd(3, "0")) / 1000;
      const txt = line.replace(regex, "").trim();
      if (!txt) return null;

      let romanized = "";
      if (this.asianRegex.test(txt)) {
        romanized = await Romanizer.romanize(txt);
        this.romajiCache[txt] = romanized;
      }
      return { time, text: txt, romanized };
    });
    return (await Promise.all(promises)).filter(Boolean);
  }

  async _resolveRomajiForLine(lineIndex) {
    if (!this.midiLines || lineIndex >= this.midiLines.length) return;
    const line = this.midiLines[lineIndex];

    const fullText = line.map((s) => s.furigana || s.text || "").join("");

    if (this.asianRegex.test(fullText)) {
      if (
        this.romajiCache[fullText] === undefined &&
        !this.pendingRomajiFetches.has(fullText)
      ) {
        this.pendingRomajiFetches.add(fullText);
        const res = await Romanizer.romanize(fullText);
        this.romajiCache[fullText] = res || "";
        this.pendingRomajiFetches.delete(fullText);

        if (
          lineIndex === this.currentSongLineIndex ||
          lineIndex === this.currentSongLineIndex + 1
        ) {
          this.calculateLyricLayout();
          this.requestCanvasCacheUpdate = true;
        }
      }
    }
  }

  triggerLineFade() {
    this.nextLineFadeStartMs = performance.now();
    const nextLineIdx = this.currentSongLineIndex + 1;
    const nextLine = this.midiLines ? this.midiLines[nextLineIdx] : null;

    if (nextLine && nextLine.length > 0) {
      const nextLineStartTime = nextLine[0].absoluteTime;
      const timeUntilNext = nextLineStartTime - (this.currentMediaTime || 0);
      this.nextLineFadeDurationMs = timeUntilNext < 1.2 ? 0 : 500;
    } else {
      this.nextLineFadeDurationMs = 0;
    }
  }

  calculateLyricLayout() {
    if (!this.allMidiSyllables && !this.parsedLrc) return;
    const canvas = this.ctx.dom.lyricsCanvas.elm;
    const ctx = this.lyricsCtx;
    const logicalWidth =
      parseFloat(canvas.style.width) || window.innerWidth * 0.9;

    const mainFontSize = Math.floor(logicalWidth * 0.045);
    const subFontSize = Math.floor(logicalWidth * 0.018);
    const mainFontStr = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
    const rubyFontStr = `700 ${subFontSize}px "Radio Canada", sans-serif`;
    const lineSpacing = mainFontSize * 1.5;
    const paragraphGap = mainFontSize * 2.4;
    let currentY = mainFontSize * 1.5;
    this.renderableLines = [];

    const buildLineLayout = (lineData, isNextLine) => {
      if (!lineData || lineData.length === 0) return;
      const flatSyllables = [];
      ctx.font = mainFontStr;

      for (let i = 0; i < lineData.length; i++) {
        const s = lineData[i];
        if (!s.furigana && s.text && s.text.match(/[ 　]/)) {
          const parts = s.text.match(/([^ 　]+[ 　]*|[ 　]+)/g);
          if (parts && parts.length > 1) {
            const totalWidth = ctx.measureText(s.text).width;
            let curAbs = s.absoluteTime;
            const totDur = s.endTime - s.absoluteTime || 0;
            for (let j = 0; j < parts.length; j++) {
              const p = parts[j];
              const pW = ctx.measureText(p).width;
              const pDur =
                totalWidth > 0
                  ? totDur * (pW / totalWidth)
                  : totDur / parts.length;
              flatSyllables.push({
                ...s,
                text: p,
                rawText: p,
                absoluteTime: curAbs,
                endTime: curAbs + pDur,
              });
              curAbs += pDur;
            }
            continue;
          }
        }
        flatSyllables.push({ ...s });
      }

      const words = [];
      let currentWord = [];

      for (let i = 0; i < flatSyllables.length; i++) {
        const s = flatSyllables[i];
        const isAsian = this.asianRegex.test(s.rawText || "");
        if (currentWord.length > 0) {
          const prev = currentWord[currentWord.length - 1];
          const prevAsian = this.asianRegex.test(prev.rawText || "");
          if (
            s.rawText.startsWith(" ") ||
            s.rawText.startsWith("　") ||
            isAsian ||
            prevAsian
          ) {
            words.push({ syllables: currentWord });
            currentWord = [];
          }
        }
        ctx.font = rubyFontStr;
        s.furiW = s.furigana ? ctx.measureText(s.furigana).width : 0;
        s.romW = 0;
        ctx.font = mainFontStr;
        s.standaloneW = s.text ? ctx.measureText(s.text).width : 0;
        currentWord.push(s);
      }
      if (currentWord.length > 0) words.push({ syllables: currentWord });

      for (let i = 0; i < words.length; i++) {
        const word = words[i].syllables;
        let requiresExpansion = false;
        for (let j = 0; j < word.length; j++) {
          if (word[j].furiW > word[j].standaloneW) {
            requiresExpansion = true;
            break;
          }
        }
        let accText = "",
          previousSubWidth = 0,
          wordTotalWidth = 0;
        for (let j = 0; j < word.length; j++) {
          const s = word[j];
          if (requiresExpansion) {
            s.origW = s.standaloneW;
            s.blockWidth = Math.max(s.origW, s.furiW, s.romW);
            s.isPartOfContinuousWord = false;
          } else {
            accText += s.text || "";
            const currentSubWidth = ctx.measureText(accText).width;
            s.origW = Math.max(0, currentSubWidth - previousSubWidth);
            previousSubWidth = currentSubWidth;
            s.blockWidth = s.origW;
            s.isPartOfContinuousWord = true;
          }
          s.isContinuousWordStart = false;
          s.continuousWordText = "";
          wordTotalWidth += s.blockWidth;
        }
        words[i].width = wordTotalWidth;
      }

      const rows = [];
      let currentRow = [],
        currentX = 0;
      const maxWidth = logicalWidth * 0.95;

      for (let i = 0; i < words.length; i++) {
        const wordInfo = words[i],
          word = wordInfo.syllables;
        if (currentX + wordInfo.width > maxWidth && currentRow.length > 0) {
          rows.push(currentRow);
          currentRow = [];
          currentX = 0;
        }
        let activeContinuousStart = null,
          activeContinuousText = "";
        for (let j = 0; j < word.length; j++) {
          const s = word[j];
          if (currentX + s.blockWidth > maxWidth && currentRow.length > 0) {
            if (activeContinuousStart) {
              activeContinuousStart.continuousWordText = activeContinuousText;
              activeContinuousStart = null;
              activeContinuousText = "";
            }
            rows.push(currentRow);
            currentRow = [];
            currentX = 0;
          }
          s.layoutX = currentX;
          currentX += s.blockWidth;
          currentRow.push(s);
          if (s.isPartOfContinuousWord) {
            if (!activeContinuousStart) {
              activeContinuousStart = s;
              s.isContinuousWordStart = true;
            }
            activeContinuousText += s.text || "";
          } else {
            if (activeContinuousStart) {
              activeContinuousStart.continuousWordText = activeContinuousText;
              activeContinuousStart = null;
              activeContinuousText = "";
            }
          }
        }
        if (activeContinuousStart)
          activeContinuousStart.continuousWordText = activeContinuousText;
      }
      if (currentRow.length > 0) rows.push(currentRow);

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        let rowText = r.map((s) => s.furigana || s.text || "").join("");

        if (this.asianRegex.test(rowText)) {
          if (this.romajiCache[rowText] !== undefined) {
            r.rowRomaji = this.romajiCache[rowText];
          } else {
            r.rowRomaji = "";
            if (!this.pendingRomajiFetches.has(rowText)) {
              this.pendingRomajiFetches.add(rowText);
              Romanizer.romanize(rowText).then((res) => {
                this.romajiCache[rowText] = res || "";
                this.pendingRomajiFetches.delete(rowText);
                this.calculateLyricLayout();
                this.requestCanvasCacheUpdate = true;
              });
            }
          }
        } else {
          r.rowRomaji = "";
        }

        let rowWidth = 0,
          hasFurigana = false;
        for (let j = 0; j < r.length; j++) {
          rowWidth += r[j].blockWidth;
          if (r[j].furiW > 0 || r[j].furigana) hasFurigana = true;
        }

        const startX = (logicalWidth - rowWidth) / 2;
        const extraTop = hasFurigana ? mainFontSize * 0.6 : 0;
        const extraBottom = r.rowRomaji ? mainFontSize * 0.6 : 0;

        if (hasFurigana) currentY += extraTop;
        r.layoutY = currentY;

        for (let j = 0; j < r.length; j++) {
          r[j].layoutX += startX;
          r[j].layoutY = currentY;
        }
        currentY += lineSpacing + extraBottom;
      }
      currentY -= lineSpacing;
      currentY += paragraphGap;
      this.renderableLines.push({
        isNextLine,
        syllables: flatSyllables,
        rows: rows,
      });
    };

    if (this.ctx.state.currentSongIsMIDI) {
      const isLine1Active = this.currentSongLineIndex % 2 === 0;
      buildLineLayout(this.currentMidiLine1, !isLine1Active);
      buildLineLayout(this.currentMidiLine2, isLine1Active);
    } else if (
      !this.ctx.state.currentSongIsMIDI &&
      this.parsedLrc &&
      this.parsedLrc.length > 0
    ) {
      const isLine1Active = !this.isLrcLine2Active && this.currentLrcIndex >= 0;
      const isLine2Active = this.isLrcLine2Active && this.currentLrcIndex >= 0;
      buildLineLayout(this.currentLrcLine1?.syllables || [], !isLine1Active);
      buildLineLayout(this.currentLrcLine2?.syllables || [], !isLine2Active);
    }

    const baseHeight = Math.max(250, mainFontSize * 10);
    const requiredHeight = Math.max(baseHeight, currentY + mainFontSize);
    const dpr = window.devicePixelRatio || 1;
    this.logicalHeight = requiredHeight;

    const currentPhysicalHeight = this.ctx.dom.lyricsCanvas.elm.height;
    const requiredPhysicalHeight = requiredHeight * dpr;

    if (Math.abs(currentPhysicalHeight - requiredPhysicalHeight) > 1) {
      this.pendingCanvasHeight = requiredHeight;
    }

    const yOffset = Math.max(0, this.logicalHeight - currentY - mainFontSize);
    if (this.renderableLines) {
      for (let i = 0; i < this.renderableLines.length; i++) {
        const line = this.renderableLines[i];
        for (let j = 0; j < line.syllables.length; j++) {
          line.syllables[j].layoutY += yOffset;
        }
        for (let j = 0; j < line.rows.length; j++) {
          line.rows[j].layoutY += yOffset;
        }
      }
    }
    this.requestCanvasCacheUpdate = true;
  }

  updateCanvasCache() {
    const canvas = this.ctx.dom.lyricsCanvas.elm;
    const width = canvas.width,
      height = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth =
      parseFloat(canvas.style.width) || window.innerWidth * 0.9;

    while (this.lineCaches.length < this.renderableLines.length) {
      const dim = document.createElement("canvas"),
        main = document.createElement("canvas");
      this.lineCaches.push({
        dim,
        dimCtx: dim.getContext("2d", { alpha: true }),
        main,
        mainCtx: main.getContext("2d", { alpha: true }),
      });
    }

    const mainFontSize = Math.floor(logicalWidth * 0.045);
    const subFontSize = Math.floor(logicalWidth * 0.018);

    this.renderableLines.forEach((line, lineIdx) => {
      const cache = this.lineCaches[lineIdx];

      if (
        cache.dim.width !== width ||
        cache.dim.height !== height ||
        cache._dpr !== dpr
      ) {
        cache.dim.width = width;
        cache.dim.height = height;
        cache.main.width = width;
        cache.main.height = height;
        cache.dimCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.dimCtx.scale(dpr, dpr);
        cache.mainCtx.scale(dpr, dpr);
        cache._dpr = dpr;
      } else {
        cache.dimCtx.save();
        cache.dimCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.dimCtx.clearRect(0, 0, width, height);
        cache.dimCtx.restore();
        cache.mainCtx.save();
        cache.mainCtx.setTransform(1, 0, 0, 1, 0, 0);
        cache.mainCtx.clearRect(0, 0, width, height);
        cache.mainCtx.restore();
      }
      cache.dimCtx.textBaseline = "alphabetic";
      cache.mainCtx.textBaseline = "alphabetic";
      cache.dimCtx.lineJoin = "round";
      cache.mainCtx.lineJoin = "round";
      line.syllables.forEach((s) => {
        if (s.isHidden) return;
        const centerX = s.layoutX + s.blockWidth / 2;
        const colors = this.ctx.state.isDuet
          ? this.getDuetColors(s.duetRole)
          : this.getDuetColors("default");

        const renderTextToCtx = (
          ctx,
          text,
          y,
          font,
          w,
          isMain,
          isRuby = false,
        ) => {
          if (!text) return;
          ctx.font = font;

          const palette = isRuby ? colors.ruby : colors;
          ctx.fillStyle = isMain ? palette.main : palette.dim;
          ctx.strokeStyle = isMain ? palette.stroke : palette.dimStroke;

          const strokeMultiplier = isRuby ? 0.12 : 0.15;
          const fontSize = font.includes(mainFontSize)
            ? mainFontSize
            : subFontSize;
          ctx.lineWidth = fontSize * strokeMultiplier;

          ctx.strokeText(text, centerX - w / 2, y);
          ctx.fillText(text, centerX - w / 2, y);
        };

        renderTextToCtx(
          cache.dimCtx,
          s.furigana,
          s.layoutY - mainFontSize * 1.1,
          `700 ${subFontSize}px "Radio Canada"`,
          s.furiW,
          false,
          true,
        );
        renderTextToCtx(
          cache.mainCtx,
          s.furigana,
          s.layoutY - mainFontSize * 1.1,
          `700 ${subFontSize}px "Radio Canada"`,
          s.furiW,
          true,
          true,
        );

        if (s.isPartOfContinuousWord) {
          if (s.isContinuousWordStart && s.continuousWordText) {
            const wordX = s.layoutX;
            cache.dimCtx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
            cache.dimCtx.fillStyle = colors.dim;
            cache.dimCtx.strokeStyle = colors.dimStroke;
            cache.dimCtx.lineWidth = mainFontSize * 0.15;
            cache.dimCtx.strokeText(s.continuousWordText, wordX, s.layoutY);
            cache.dimCtx.fillText(s.continuousWordText, wordX, s.layoutY);

            cache.mainCtx.font = `900 ${mainFontSize}px "Radio Canada", sans-serif`;
            cache.mainCtx.fillStyle = colors.main;
            cache.mainCtx.strokeStyle = colors.stroke;
            cache.mainCtx.lineWidth = mainFontSize * 0.15;
            cache.mainCtx.strokeText(s.continuousWordText, wordX, s.layoutY);
            cache.mainCtx.fillText(s.continuousWordText, wordX, s.layoutY);
          }
        } else {
          renderTextToCtx(
            cache.dimCtx,
            s.text || "",
            s.layoutY,
            `900 ${mainFontSize}px "Radio Canada", sans-serif`,
            s.origW,
            false,
          );
          renderTextToCtx(
            cache.mainCtx,
            s.text || "",
            s.layoutY,
            `900 ${mainFontSize}px "Radio Canada", sans-serif`,
            s.origW,
            true,
          );
        }
      });

      cache.dimCtx.textAlign = "center";

      line.rows.forEach((r) => {
        if (r.rowRomaji) {
          const dominantRole = r[0]?.duetRole || "default";
          const colors = this.ctx.state.isDuet
            ? this.getDuetColors(dominantRole)
            : this.getDuetColors("default");

          const romajiY = r.layoutY + mainFontSize * 0.6;
          const romajiX = logicalWidth / 2;

          cache.dimCtx.font = `700 ${subFontSize}px "Radio Canada"`;
          cache.dimCtx.fillStyle = colors.romaji.text;
          cache.dimCtx.strokeStyle = colors.romaji.stroke;
          cache.dimCtx.lineWidth = subFontSize * 0.12;

          cache.dimCtx.strokeText(r.rowRomaji, romajiX, romajiY);
          cache.dimCtx.fillText(r.rowRomaji, romajiX, romajiY);
        }
      });

      cache.dimCtx.textAlign = "left";
    });
  }

  drawLyricsFrame() {
    if (this.ctx.state.mode !== "player") return;
    if (this.ctx.state.isInterludeActive) {
      this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
      return;
    }
    const ctx = this.lyricsCtx;
    const canvas = this.ctx.dom.lyricsCanvas.elm;
    const logicalWidth =
      parseFloat(canvas.style.width) || window.innerWidth * 0.9;

    if (this.pendingCanvasHeight) {
      const dpr = window.devicePixelRatio || 1;
      canvas.height = this.pendingCanvasHeight * dpr;
      this.ctx.dom.lyricsCanvas.styleJs({
        height: `${this.pendingCanvasHeight}px`,
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      this.pendingCanvasHeight = null;
      this.requestCanvasCacheUpdate = true;
    }

    const logicalHeight = canvas.height / (window.devicePixelRatio || 1);
    const mainFontSize = Math.floor(logicalWidth * 0.045);

    if (this.requestCanvasCacheUpdate) {
      this.updateCanvasCache();
      this.requestCanvasCacheUpdate = false;
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    const isLrcMode =
      !this.ctx.state.currentSongIsMIDI &&
      this.parsedLrc &&
      this.parsedLrc.length > 0;

    if (this.ctx.state.currentSongIsMIDI || isLrcMode) {
      if (!this.renderableLines) {
        this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
        return;
      }
      let fadeProgress = 1.0;
      if (this.nextLineFadeStartMs && this.nextLineFadeDurationMs > 0) {
        fadeProgress = Math.min(
          1.0,
          (performance.now() - this.nextLineFadeStartMs) /
            this.nextLineFadeDurationMs,
        );
      }

      this.renderableLines.forEach((line, lineIdx) => {
        const cache = this.lineCaches[lineIdx];
        if (!cache) return;
        ctx.globalAlpha = line.isNextLine ? fadeProgress : 1.0;
        ctx.drawImage(cache.dim, 0, 0, logicalWidth, logicalHeight);
      });

      ctx.globalAlpha = 1.0;

      let baseTime = this.currentMediaTime || 0;
      if (this.lastMediaTimeUpdate) {
        const diff = (performance.now() - this.lastMediaTimeUpdate) / 1000;
        if (diff < 0.1) {
          baseTime += diff;
        }
      }

      const LYRICS_SYNC_OFFSET = 0.08;
      const currentTime = baseTime + LYRICS_SYNC_OFFSET;

      this.renderableLines.forEach((line, lineIdx) => {
        if (
          line.isNextLine &&
          (isLrcMode ||
            !line.syllables ||
            line.syllables.length === 0 ||
            currentTime < line.syllables[0].absoluteTime)
        ) {
          return;
        }
        const cache = this.lineCaches[lineIdx];
        if (!cache) return;

        ctx.save();
        if (line.isNextLine) {
          ctx.globalAlpha = fadeProgress;
        } else if (isLrcMode && this.lrcChangeTime) {
          ctx.globalAlpha = Math.min(
            1.0,
            Math.max(0, (performance.now() - this.lrcChangeTime) / 300),
          );
        }
        ctx.beginPath();

        line.syllables.forEach((s) => {
          if (s.isHidden) return;
          const centerX = s.layoutX + s.blockWidth / 2;
          let progress = 0;

          if (isLrcMode) {
            progress = 1;
          } else {
            if (currentTime >= s.endTime) progress = 1;
            else if (currentTime >= s.absoluteTime) {
              const duration = s.endTime - s.absoluteTime;
              progress =
                duration > 0 ? (currentTime - s.absoluteTime) / duration : 1;
            }
          }

          if (progress > 0) {
            let clipTop = s.layoutY - mainFontSize * 0.9;
            let clipBottom = s.layoutY + mainFontSize * 0.35;

            if (s.furigana) clipTop -= mainFontSize * 0.6;

            let clipLeft = centerX - s.blockWidth / 2 - 5;
            let clipWidth = (s.blockWidth + 10) * progress;

            ctx.rect(clipLeft, clipTop, clipWidth, clipBottom - clipTop);
          }
        });
        ctx.clip();
        ctx.drawImage(cache.main, 0, 0, logicalWidth, logicalHeight);
        ctx.restore();
      });
    }
    this.lyricsRafId = requestAnimationFrame(() => this.drawLyricsFrame());
  }

  setupTimeUpdate(mvPlayer) {
    let currentLrcIndex = -1;
    this.lastCountdownTick = null;

    this.boundTimeUpdate = (e) => {
      const { currentTime } = e.detail;
      this.currentMediaTime = currentTime;
      this.lastMediaTimeUpdate = performance.now();

      if (this.midiLines && this.midiLines.length > 0) {
        let newLineIndex = Math.max(0, this.currentSongLineIndex);

        if (
          newLineIndex > 0 &&
          currentTime < this.midiLines[newLineIndex - 1][0].absoluteTime
        ) {
          newLineIndex = 0;
        }

        for (let i = newLineIndex; i < this.midiLines.length; i++) {
          let line = this.midiLines[i];
          if (line.length === 0) continue;
          if (currentTime >= line[line.length - 1].endTime + 0.1)
            newLineIndex = i + 1;
          else break;
        }
        newLineIndex = Math.min(newLineIndex, this.midiLines.length - 1);

        if (this.currentSongLineIndex !== newLineIndex) {
          this.currentSongLineIndex = newLineIndex;
          this.triggerLineFade();

          if (this.currentSongLineIndex % 2 === 0) {
            this.currentMidiLine1 =
              this.midiLines[this.currentSongLineIndex] || [];
            this.currentMidiLine2 =
              this.midiLines[this.currentSongLineIndex + 1] || [];
          } else {
            this.currentMidiLine2 =
              this.midiLines[this.currentSongLineIndex] || [];
            this.currentMidiLine1 =
              this.midiLines[this.currentSongLineIndex + 1] || [];
          }
          this.calculateLyricLayout();
          this.requestCanvasCacheUpdate = true;
          this._resolveRomajiForLine(this.currentSongLineIndex + 2);
        }
      }

      if (mvPlayer) {
        const target = currentTime + this.ctx.state.videoSyncOffset / 1000;
        const drift = (target - mvPlayer.currentTime) * 1000;
        if (Math.abs(drift) > 500) {
          mvPlayer.currentTime = target;
          mvPlayer.playbackRate = 1;
        } else if (Math.abs(drift) > 50)
          mvPlayer.playbackRate = drift > 0 ? 1.05 : 0.95;
        else mvPlayer.playbackRate = 1;
      }

      if (this.interludes && this.interludes.length > 0) {
        let inInterlude = this.interludes.find(
          (ind) => currentTime >= ind.start && currentTime < ind.end,
        );
        if (inInterlude) {
          if (!this.ctx.state.isInterludeActive) {
            this.ctx.state.isInterludeActive = true;
            const tip =
              this.tempTips[Math.floor(Math.random() * this.tempTips.length)];
            this.ctx.dom.interludeTipBox.text(tip);
            this.tempTips.splice(this.tempTips.indexOf(tip), 1);
            if (this.tempTips.length === 0)
              this.tempTips = structuredClone(INTERLUDE_TIPS);
            this.ctx.dom.interludeOverlay.classOn("visible");
            this.ctx.dom.lyricsCanvas.styleJs({ opacity: "0" });
          }
        } else {
          if (this.ctx.state.isInterludeActive) {
            this.ctx.state.isInterludeActive = false;
            this.ctx.dom.interludeOverlay.classOff("visible");
            this.ctx.dom.lyricsCanvas.styleJs({ opacity: "1" });
          }
        }
      }

      if (this.countdowns && this.countdowns.length > 0) {
        let activeCd = this.countdowns.find((c) =>
          typeof c === "number"
            ? c - currentTime > 0.2 && c - currentTime <= 3.2
            : currentTime >= c.t3 && currentTime < c.t0,
        );
        if (activeCd) {
          let tick = null;
          if (typeof activeCd === "number") {
            let rem = activeCd - currentTime;
            tick = Math.ceil(rem).toString();
            if (parseInt(tick) > 3) tick = null;
          } else {
            if (currentTime >= activeCd.t1) tick = "1";
            else if (currentTime >= activeCd.t2) tick = "2";
            else if (currentTime >= activeCd.t3) tick = "3";
          }
          if (tick && tick !== this.lastCountdownTick) {
            this.lastCountdownTick = tick;
            this.ctx.dom.countdownDisplay.text(tick).classOn("visible");
          }
        } else if (this.lastCountdownTick !== null) {
          this.lastCountdownTick = null;
          this.ctx.dom.countdownDisplay.classOff("visible");
        }
      }

      if (this.parsedLrc && this.parsedLrc.length) {
        let newIdx = currentLrcIndex;
        while (
          newIdx + 1 < this.parsedLrc.length &&
          currentTime >= this.parsedLrc[newIdx + 1].time
        )
          newIdx++;
        if (newIdx > 0 && currentTime < this.parsedLrc[newIdx].time) {
          newIdx = -1;
          while (
            newIdx + 1 < this.parsedLrc.length &&
            currentTime >= this.parsedLrc[newIdx + 1].time
          )
            newIdx++;
        }

        if (newIdx !== currentLrcIndex && newIdx >= 0) {
          if (this.nextLineUpdateTimeout)
            clearTimeout(this.nextLineUpdateTimeout);
          currentLrcIndex = newIdx;
          this.currentLrcIndex = currentLrcIndex;
          this.isLrcLine2Active = currentLrcIndex % 2 !== 0;
          this.lrcChangeTime = performance.now();

          if (this.isLrcLine2Active) {
            this.currentLrcLine2 = this.parsedLrc[currentLrcIndex];
            this.currentLrcLine1 = this.parsedLrc[currentLrcIndex + 1];
          } else {
            this.currentLrcLine1 = this.parsedLrc[currentLrcIndex];
            this.currentLrcLine2 = this.parsedLrc[currentLrcIndex + 1];
          }

          if (currentLrcIndex > 0) {
            this.nextLineFadeStartMs = performance.now();
            this.nextLineFadeDurationMs = 500;
          }
          this.calculateLyricLayout();
        }
      }
    };
    document.addEventListener(
      "CherryTree.Forte.Playback.TimeUpdate",
      this.boundTimeUpdate,
    );
  }
}
