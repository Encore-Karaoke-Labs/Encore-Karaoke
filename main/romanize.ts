import _Kuroshiro from "kuroshiro";
import _KuromojiAnalyzer from "kuroshiro-analyzer-kuromoji";
import { logger } from "./logger";

interface KuroshiroAnalyzer {
  init?: () => Promise<void>;
}

interface KuroshiroStaticUtil {
  kanaToRomaji(text: string, system: string): Promise<string>;
}

interface KuroshiroInstance {
  init(analyzer: KuroshiroAnalyzer): Promise<void>;
  convert(
    text: string,
    options?: {
      to?: "hiragana" | "katakana" | "romaji";
      mode?: "normal" | "spaced" | "okurigana" | "furigana";
      romajiSystem?: "nippon" | "passport" | "hepburn";
    },
  ): Promise<string>;
}

type KuroshiroConstructor = new () => KuroshiroInstance;

const KuroshiroClass = ((
  _Kuroshiro as unknown as { default?: KuroshiroConstructor }
).default ?? _Kuroshiro) as unknown as KuroshiroConstructor & {
  Util: KuroshiroStaticUtil;
};

const KuromojiAnalyzerClass = ((
  _KuromojiAnalyzer as unknown as {
    default?: new () => KuroshiroAnalyzer;
  }
).default ?? _KuromojiAnalyzer) as unknown as new () => KuroshiroAnalyzer;

const kuroshiro = new KuroshiroClass();
void kuroshiro.init(new KuromojiAnalyzerClass());

export async function romanizeText(rawJapanese: unknown): Promise<string> {
  if (!rawJapanese || typeof rawJapanese !== "string") return "";

  try {
    const cleanText = rawJapanese.replace(/[\r\n\t]/g, " ").trim();
    if (!cleanText) return "";

    let romaji = await kuroshiro.convert(cleanText, {
      to: "romaji",
      mode: "spaced",
      romajiSystem: "hepburn",
    });

    romaji = romaji
      .replace(/\s+/g, " ") // Collapse multiple spaces.
      .replace(/\s+([,.\?!♪~～''])/g, "$1") // Remove space right before punctuation/symbols.
      .replace(/([（(])\s+/g, "$1") // Remove space right after opening brackets.
      .trim();

    return romaji;
  } catch (error) {
    const err = error as Error;
    logger.warn(
      "ROMANIZE",
      `Kuromoji conversion failed for "${rawJapanese}": ${err.message}. Using safe fallback.`,
    );

    try {
      const fallbackRomaji = await KuroshiroClass.Util.kanaToRomaji(
        rawJapanese,
        "hepburn",
      );
      return fallbackRomaji.replace(/\s+/g, " ").trim();
    } catch (fallbackError) {
      const fbErr = fallbackError as Error;
      logger.error(
        "ROMANIZE",
        `Fallback romanization failed: ${fbErr.message}`,
      );
      return rawJapanese;
    }
  }
}
