import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type WebContentsView,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { appState } from "./state";
import { logger } from "./logger";
import { platformHints } from "./runtime";
import type {
  SaveCachePayload,
  SongbookExportPayload,
  SongbookProgressPayload,
  SongbookReceivePayload,
} from "./types";

const krRegex = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/; // Hangul (Korean)
const kanaRegex = /[\u3040-\u30ff\u31f0-\u31ff]/; // Hiragana & Katakana (Japanese)
const hanIdeographsRegex = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/; // Hanzi/Kanji/Hanja

export function registerSongbookIpc(): void {
  ipcMain.handle(
    "libmgr-export-songbook",
    async (event, payload: SongbookExportPayload) => {
      if (platformHints.has("no-library-manager")) {
        return { success: false, reason: "Disabled by platform hints." };
      }

      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { success: false, reason: "Window not found." };
      const { folderPath, libraryTitle } = payload;

      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: "Export Encore Songbook",
        defaultPath: path.join(
          app.getPath("documents"),
          `${libraryTitle.replace(/[^a-z0-9]/gi, "_")}_Songbook.pdf`,
        ),
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) return { success: false, reason: "canceled" };

      const mainWin = BrowserWindow.getAllWindows().find(
        (w) => !w.title.includes("Library Manager"),
      );
      const view = mainWin?.contentView.children[0] as
        WebContentsView | undefined;
      if (mainWin && view) {
        view.webContents.send("request-songbook-data", {
          folderPath,
          filePath,
          libraryTitle,
        });
        return { success: true, pending: true };
      } else {
        return { success: false, reason: "Main app process not found." };
      }
    },
  );

  ipcMain.on(
    "songbook-build-progress",
    (_event, data: SongbookProgressPayload) => {
      appState.isSongbookBuildActive = true;
      if (appState.libraryManagerWin) {
        appState.libraryManagerWin.webContents.send(
          "songbook-export-progress",
          {
            phase: "Scanning Library...",
            current: data.current,
            total: data.total,
            percentage: data.percentage,
          },
        );
      }
    },
  );

  ipcMain.on(
    "receive-songbook-data",
    (_event, payload: SongbookReceivePayload) => {
      appState.isSongbookBuildActive = true;
      const { songs, filePath, libraryTitle } = payload;

      if (!songs || songs.length === 0) {
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("songbook-export-complete", {
            success: false,
            reason: "Library is empty or failed to parse.",
          }),
        );
        return;
      }

      let fontRajdhani: Buffer;
      let fontRajdhaniBold: Buffer;
      let fontRadioCanada: Buffer;
      let fontJP: Buffer | undefined;
      let fontKR: Buffer | undefined;
      let fontSC: Buffer | undefined;

      try {
        fontRajdhani = fs.readFileSync(
          path.join(
            appState.staticAssetsPath,
            "assets",
            "fonts",
            "Rajdhani-Regular.ttf",
          ),
        );
        fontRajdhaniBold = fs.readFileSync(
          path.join(
            appState.staticAssetsPath,
            "assets",
            "fonts",
            "Rajdhani-Bold.ttf",
          ),
        );
        fontRadioCanada = fs.readFileSync(
          path.join(
            appState.staticAssetsPath,
            "assets",
            "fonts",
            "RadioCanada-Regular.ttf",
          ),
        );

        const jpPath = path.join(
          appState.staticAssetsPath,
          "assets",
          "fonts",
          "NotoSansJP-Regular.ttf",
        );
        if (fs.existsSync(jpPath)) fontJP = fs.readFileSync(jpPath);
        else logger.warn("SYSTEM", "NotoSansJP-Regular.ttf missing!");

        const krPath = path.join(
          appState.staticAssetsPath,
          "assets",
          "fonts",
          "NotoSansKR-Regular.ttf",
        );
        if (fs.existsSync(krPath)) fontKR = fs.readFileSync(krPath);
        else logger.warn("SYSTEM", "NotoSansKR-Regular.ttf missing!");

        const scPath = path.join(
          appState.staticAssetsPath,
          "assets",
          "fonts",
          "NotoSansSC-Regular.ttf",
        );
        if (fs.existsSync(scPath)) fontSC = fs.readFileSync(scPath);
        else logger.warn("SYSTEM", "NotoSansSC-Regular.ttf missing!");
      } catch (fontErr) {
        const err = fontErr as Error;
        logger.error("SYSTEM", `PDF Font Error: ${err.message}`);
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("songbook-export-complete", {
            success: false,
            reason: err.message,
          }),
        );
        return;
      }

      const getFontForText = (text: string, defaultFont: string): string => {
        if (fontKR && krRegex.test(text)) return "KR-Fallback";
        if (fontJP && kanaRegex.test(text)) return "JP-Fallback";
        if (hanIdeographsRegex.test(text)) {
          if (fontSC) return "SC-Fallback";
          if (fontJP) return "JP-Fallback";
        }
        return defaultFont;
      };

      try {
        songs.sort((a, b) => (a.title || "").localeCompare(b.title || ""));

        const doc = new PDFDocument({
          margin: 40,
          size: "A4",
          font: fontRajdhani as any,
        });

        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        doc.registerFont("Rajdhani-Bold", fontRajdhaniBold);
        doc.registerFont("RadioCanada", fontRadioCanada);
        doc.registerFont("Rajdhani", fontRajdhani);

        if (fontJP) doc.registerFont("JP-Fallback", fontJP);
        if (fontKR) doc.registerFont("KR-Fallback", fontKR);
        if (fontSC) doc.registerFont("SC-Fallback", fontSC);

        doc.rect(0, 0, doc.page.width, doc.page.height).fill("#080810");

        const coverTitleFont = getFontForText(libraryTitle, "Rajdhani-Bold");
        doc
          .fillColor("#89cff0")
          .font(coverTitleFont)
          .fontSize(65)
          .text(libraryTitle.toUpperCase(), 40, 60, {
            width: doc.page.width - 80,
            characterSpacing: 2,
            align: "left",
          });

        doc
          .fillColor("#ffd700")
          .font("Rajdhani")
          .fontSize(30)
          .text(`${songs.length} SONGS`, 40, doc.y + 10, {
            characterSpacing: 1,
            align: "left",
          });

        doc.moveDown(2);
        doc
          .fillColor("#ffffff")
          .font("RadioCanada")
          .fontSize(16)
          .text(`Generated on ${new Date().toLocaleDateString()}`, 40, doc.y, {
            align: "left",
          });

        doc.addPage();

        const margins = 40;
        const gutter = 20;
        const colWidth = (doc.page.width - margins * 2 - gutter) / 2;
        const bottomLimit = doc.page.height - margins;

        let col = 0;
        let currentY = margins;
        let currentLetter = "";

        const checkSpace = (requiredHeight: number): void => {
          if (currentY + requiredHeight > bottomLimit) {
            col++;
            if (col > 1) {
              col = 0;
              doc.addPage();
            }
            currentY = margins;
          }
        };

        const processSongs = async (): Promise<void> => {
          for (let i = 0; i < songs.length; i++) {
            const song = songs[i];
            const safeTitle = (song.title || "Unknown").replace(
              /[\u0000-\x1F\x7F-\x9F]/g,
              "",
            );
            const safeArtist = (song.artist || "Unknown").replace(
              /[\u0000-\x1F\x7F-\x9F]/g,
              "",
            );

            const firstLetter = safeTitle.charAt(0).toUpperCase();
            const isLetter = /^[A-Z]$/.test(firstLetter);
            const groupingLetter = isLetter ? firstLetter : "#";

            const needsHeader = groupingLetter !== currentLetter;
            const requiredHeight = 34 + (needsHeader ? 30 : 0);

            checkSpace(requiredHeight);

            const x = margins + col * (colWidth + gutter);

            if (needsHeader) {
              currentLetter = groupingLetter;

              doc.rect(x, currentY, colWidth, 22).fill("#89cff0");
              doc
                .fillColor("#080810")
                .fontSize(16)
                .font("Rajdhani-Bold")
                .text(currentLetter, x + 8, currentY + 3.5);

              currentY += 30;
            }

            const boxX = x;
            const boxY = currentY;
            const boxW = colWidth;
            const boxH = 30;

            doc.lineWidth(0.5).strokeColor("#cccccc");
            doc.roundedRect(boxX, boxY, boxW, boxH, 4).stroke();

            const textX = boxX + 8;
            const textY = boxY + 5;
            const infoBlockX = textX + 46;

            let formatText = "[RS]";
            let formatColor = "#B02FD1";

            if (song.videoPath) {
              formatText = "[MV]";
              formatColor = "#2F6CD1";
            } else if (song.chorusPath) {
              formatText = "[CHR]";
              formatColor = "#FFD700";
            } else if (song.type === "multiplexed") {
              formatText = "[MP]";
              formatColor = "#2FD147";
            } else if (
              song.type === "mid" ||
              song.type === "kar" ||
              song.type === "midi"
            ) {
              formatText = "[MIDI]";
              formatColor = "#D12F9E";
            }

            doc
              .font("Rajdhani-Bold")
              .fontSize(11.5)
              .fillColor("#000000")
              .text(String(song.code).padStart(6, "0"), textX, textY, {
                width: 44,
                lineBreak: false,
              });

            const maxInfoWidth = boxW - 46 - 8;
            doc.font("Rajdhani-Bold").fontSize(11);
            const formatWidth = doc.widthOfString(formatText);
            const gap = 4;
            const titleStartX = infoBlockX + formatWidth + gap;
            const availableTitleWidth = maxInfoWidth - formatWidth - gap;

            doc
              .fillColor(formatColor)
              .text(formatText, infoBlockX, textY, { lineBreak: false });

            let displayTitle = safeTitle;
            const titleFont = getFontForText(displayTitle, "Rajdhani-Bold");
            doc.font(titleFont).fontSize(11);

            if (doc.widthOfString(displayTitle) > availableTitleWidth) {
              while (
                displayTitle.length > 0 &&
                doc.widthOfString(displayTitle + "...") > availableTitleWidth
              ) {
                displayTitle = displayTitle.slice(0, -1);
              }
              displayTitle += "...";
            }

            doc
              .fillColor("#000000")
              .text(displayTitle, titleStartX, textY, { lineBreak: false });

            const artistFont = getFontForText(safeArtist, "RadioCanada");
            doc
              .font(artistFont)
              .fontSize(9)
              .fillColor("#555555")
              .text(safeArtist, infoBlockX, textY + 12, {
                width: maxInfoWidth,
                height: 11,
                lineBreak: false,
                ellipsis: true,
              });

            currentY += 34;

            if (i % 50 === 0 || i === songs.length - 1) {
              const currentCount = i + 1;
              BrowserWindow.getAllWindows().forEach((w) =>
                w.webContents.send("songbook-export-progress", {
                  phase: "Generating PDF...",
                  current: currentCount,
                  total: songs.length,
                  percentage: Math.round((currentCount / songs.length) * 100),
                }),
              );
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }

          doc.end();
        };

        processSongs().catch((err: Error) => {
          logger.error("SYSTEM", `PDF Loop Error: ${err.message}`);
          BrowserWindow.getAllWindows().forEach((w) =>
            w.webContents.send("songbook-export-complete", {
              success: false,
              reason: err.message,
            }),
          );
        });

        stream.on("finish", () => {
          BrowserWindow.getAllWindows().forEach((w) =>
            w.webContents.send("songbook-export-complete", { success: true }),
          );
        });
        stream.on("error", (err: Error) => {
          logger.error("SYSTEM", `PDF Stream Error: ${err.message}`);
          BrowserWindow.getAllWindows().forEach((w) =>
            w.webContents.send("songbook-export-complete", {
              success: false,
              reason: err.message,
            }),
          );
        });
      } catch (err) {
        const error = err as Error;
        logger.error("SYSTEM", `PDF Generation crashed: ${error.message}`);
        BrowserWindow.getAllWindows().forEach((w) =>
          w.webContents.send("songbook-export-complete", {
            success: false,
            reason: error.message,
          }),
        );
      }
    },
  );

  ipcMain.on("songbook-export-complete", () => {
    appState.isSongbookBuildActive = false;
  });

  ipcMain.handle(
    "save-songbook-cache",
    async (_event, payload: SaveCachePayload) => {
      try {
        if (!payload || !payload.libraryPath) {
          return { success: false, error: "No library path provided." };
        }

        const { libraryPath, songList, newSongs, signature } = payload;
        const cachePath = path.join(libraryPath, "songdb.json");

        const cacheData = JSON.stringify(
          { signature, songList, newSongs },
          null,
          2,
        );
        await fs.promises.writeFile(cachePath, cacheData, "utf8");

        logger.info("SYSTEM", `Successfully embedded cache to ${cachePath}`);
        return { success: true };
      } catch (e) {
        const err = e as Error;
        logger.error("SYSTEM", `Failed to save embedded cache: ${err.message}`);
        return { success: false, error: err.message };
      }
    },
  );
}
