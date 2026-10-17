import { createWorker, OEM, PSM } from "tesseract.js";
import type { LoggerMessage, Worker } from "tesseract.js";

import type { ClientOCRResult, ReceiptOCRResult } from "../types";
import {
  createSerialTaskQueue,
  raceWithAbort,
} from "../utils/serialTaskQueue";

type ProgressListener = (message: LoggerMessage) => void;

export type ReceiptImageCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const totalKeywords = /(?:合\s*(?:計|言\s*[十ニ二])|言\s*[十ニ二]|お\s*買\s*上(?:げ)?\s*金\s*額|ご\s*請\s*求\s*額|現\s*計|総\s*額)/;
const datePattern = /(?<year>20\d{2})\s*(?:\/|\.|年)\s*(?<month>\d{1,2})\s*(?:\/|\.|月)\s*(?<day>\d{1,2})(?:日)?/;
const currencyAmountPattern = /(?:¥|￥|\\|Y)\s*([0-9]{1,3}(?:[,.]\s?[0-9]{3})+|[0-9]+)/gi;
const plainAmountPattern = /(?<![0-9A-Za-z])([0-9]{1,3}(?:[,.]\s?[0-9]{3})+|[0-9]+)(?![0-9A-Za-z])/g;
const nonTotalAmountLine = /(?:現\s*金|お\s*預|預\s*り|釣|お\s*つ\s*り|消費\s*税|税\s*額)/;
const nonShopNameLine = /(?:単行本|領収書|領収証|レシート|登録番号|適格請求書|[TＴ]\d{13}|ありがとう\s*ござい(?:ます|ました)?|(?:予め\s*)?ご了承ください(?:ませ)?|くださいませ)/;
const maxReceiptImageSide = 2200;
const maxReceiptImagePixels = 4_000_000;
const shopHeaderHeightRatio = 0.45;

let progressListener: ProgressListener | null = null;
let workerPromise: Promise<Worker> | null = null;
let recognitionPass = 0;
const enqueueOcr = createSerialTaskQueue();

function findTotalKeyword(line: string) {
  let offset = 0;
  while (offset <= line.length) {
    const match = totalKeywords.exec(line.slice(offset));
    if (!match) {
      return null;
    }

    const index = offset + match.index;
    const prefix = line.slice(0, index).replace(/\s/g, "");
    if (!prefix.endsWith("商品")) {
      return { index, text: match[0] };
    }
    offset = index + match[0].length;
  }

  return null;
}

function isExactTotalKeyword(keyword: { text: string }) {
  return keyword.text.replace(/\s/g, "") === "合計";
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(["jpn", "eng"], OEM.LSTM_ONLY, {
      logger: (message) => {
        if (message.status !== "recognizing text") {
          progressListener?.({
            ...message,
            progress: message.progress * 0.1,
          });
          return;
        }
        const offset = recognitionPass === 1 ? 0.1 : recognitionPass === 2 ? 0.4 : 0.7;
        progressListener?.({
          ...message,
          progress: offset + message.progress * 0.3,
        });
      },
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

export function runReceiptOcr(
  image: File,
  onProgress?: ProgressListener,
  signal?: AbortSignal,
  crop?: ReceiptImageCrop,
): Promise<ReceiptOCRResult> {
  return enqueueOcr(
    () => runReceiptOcrExclusive(image, onProgress, signal, crop),
    signal,
  );
}

async function runReceiptOcrExclusive(
  image: File,
  onProgress?: ProgressListener,
  signal?: AbortSignal,
  crop?: ReceiptImageCrop,
): Promise<ReceiptOCRResult> {
  progressListener = onProgress ?? null;
  let preparedImage: HTMLCanvasElement | null = null;
  let headerImage: HTMLCanvasElement | null = null;
  let worker: Worker | null = null;
  const handleAbort = () => {
    if (!worker) {
      return;
    }
    workerPromise = null;
    void worker.terminate().catch(() => undefined);
  };

  try {
    throwIfAborted(signal);
    worker = await raceWithAbort(getWorker(), signal);
    throwIfAborted(signal);
    signal?.addEventListener("abort", handleAbort, { once: true });
    preparedImage = await prepareReceiptImage(image, crop);
    throwIfAborted(signal);
    await raceWithAbort(
      worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: "0",
      }),
      signal,
    );
    recognitionPass = 1;
    const originalResult = await raceWithAbort(
      worker.recognize(
        preparedImage,
        {},
        { text: true, blocks: true },
      ),
      signal,
    );
    throwIfAborted(signal);

    let enhancedResult: Tesseract.RecognizeResult | null = null;
    try {
      enhanceReceiptImage(preparedImage);
      await raceWithAbort(
        worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
        signal,
      );
      recognitionPass = 2;
      enhancedResult = await raceWithAbort(
        worker.recognize(
          preparedImage,
          { rotateAuto: true },
          { text: true, blocks: true },
        ),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      // The original pass remains usable if browser image preprocessing or
      // the second recognition pass is unavailable.
    } finally {
      if (!signal?.aborted) {
        try {
          await raceWithAbort(
            worker.setParameters({
              tessedit_pageseg_mode: PSM.AUTO,
              preserve_interword_spaces: "0",
            }),
            signal,
          );
        } catch {
          // The next run configures the page segmentation mode again.
        }
      }
    }
    throwIfAborted(signal);

    let headerResult: Tesseract.RecognizeResult | null = null;
    try {
      headerImage = createReceiptHeaderImage(preparedImage);
      await raceWithAbort(
        worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
        signal,
      );
      recognitionPass = 3;
      headerResult = await raceWithAbort(
        worker.recognize(headerImage, {}, { text: true, blocks: true }),
        signal,
      );
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      // Full-page recognition remains usable if the header pass is unavailable.
    } finally {
      if (!signal?.aborted) {
        try {
          await raceWithAbort(
            worker.setParameters({
              tessedit_pageseg_mode: PSM.AUTO,
              preserve_interword_spaces: "0",
            }),
            signal,
          );
        } catch {
          // The next run configures the page segmentation mode again.
        }
      }
    }
    throwIfAborted(signal);

    const originalText = originalResult.data.text.trim();
    const enhancedText = enhancedResult?.data.text.trim() ?? "";
    const headerText = headerResult?.data.text.trim() ?? "";
    const originalLines = extractLines(
      originalResult.data,
      originalText,
      preparedImage.height,
      preparedImage.width,
    );
    const enhancedLines = enhancedResult
      ? extractLines(
          enhancedResult.data,
          enhancedText,
          preparedImage.height,
          preparedImage.width,
        )
      : [];
    const headerLines = headerResult
      ? extractLines(
          headerResult.data,
          headerText,
          preparedImage.height,
          preparedImage.width,
          0,
          headerImage?.height ?? 0,
        )
      : [];
    const usableOriginalLines = excludeLikelyInvertedLines(originalLines, preparedImage);
    const usableEnhancedLines = excludeLikelyInvertedLines(enhancedLines, preparedImage);
    const usableHeaderLines = headerImage
      ? excludeLikelyInvertedLines(headerLines, headerImage)
      : headerLines;
    const rawText = enhancedText.length > originalText.length ? enhancedText : originalText;
    const confidence = enhancedResult
      ? (originalResult.data.confidence + enhancedResult.data.confidence) / 2
      : originalResult.data.confidence;
    const shopName = selectFieldCandidate([
      getShopNameCandidate(usableOriginalLines),
      getShopNameCandidate(usableEnhancedLines),
      getShopNameCandidate(usableHeaderLines),
    ]);
    const purchasedAt = selectFieldCandidate([
      getDateCandidate(
        usableOriginalLines,
        usableOriginalLines.map((line) => line.text).join("\n"),
        originalResult.data.confidence,
      ),
      enhancedResult
        ? getDateCandidate(
            usableEnhancedLines,
            usableEnhancedLines.map((line) => line.text).join("\n"),
            enhancedResult.data.confidence,
          )
        : null,
      headerResult
        ? getDateCandidate(
            usableHeaderLines,
            usableHeaderLines.map((line) => line.text).join("\n"),
            headerResult.data.confidence,
          )
        : null,
    ]);
    const totalAmount = selectFieldCandidate([
      getTotalAmountCandidate(
        usableOriginalLines,
        usableOriginalLines.map((line) => line.text).join("\n"),
        originalResult.data.confidence,
      ),
      enhancedResult
        ? getTotalAmountCandidate(
            usableEnhancedLines,
            usableEnhancedLines.map((line) => line.text).join("\n"),
            enhancedResult.data.confidence,
          )
        : null,
    ]);

    return {
      shop_name: shopName.value,
      purchased_at: purchasedAt.value,
      total_amount: totalAmount.value,
      raw_ocr_text: rawText,
      confidence,
      field_confidence: {
        shop_name: shopName.confidence,
        purchased_at: purchasedAt.confidence,
        total_amount: totalAmount.confidence,
      },
      engine: "tesseract.js",
    };
  } finally {
    signal?.removeEventListener("abort", handleAbort);
    if (preparedImage) {
      preparedImage.width = 0;
      preparedImage.height = 0;
    }
    if (headerImage) {
      headerImage.width = 0;
      headerImage.height = 0;
    }
    recognitionPass = 0;
    if (progressListener === onProgress) {
      progressListener = null;
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("OCR解析を中止しました。", "AbortError");
  }
}

export type OCRLine = {
  text: string;
  confidence: number;
  top?: number;
  height?: number;
  left?: number;
  width?: number;
};

function extractLines(
  data: Tesseract.Page,
  rawText: string,
  pageHeight: number,
  pageWidth: number,
  yOffset = 0,
  regionHeight = pageHeight,
): OCRLine[] {
  const detectedLines =
    data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.map((line) => ({
          text: normalizeOCRText(line.text),
          confidence: line.confidence,
          top: (yOffset + line.bbox.y0) / pageHeight,
          height: line.bbox.y1 - line.bbox.y0,
          left: line.bbox.x0 / pageWidth,
          width: (line.bbox.x1 - line.bbox.x0) / pageWidth,
        })),
      ),
    ) ?? [];

  if (detectedLines.length > 0) {
    return detectedLines.filter((line) => line.text.length > 0);
  }

  const rawLines = rawText
    .split(/\r?\n/)
    .map(normalizeOCRText)
    .filter((line) => line.length > 0);
  return rawLines.map((line, index) => ({
    text: line,
    confidence: data.confidence,
    top: (yOffset + (index / Math.max(rawLines.length, 1)) * regionHeight) / pageHeight,
  }));
}

export function isLikelyInvertedTextRegion(darkPixelRatio: number, lightPixelRatio: number) {
  return darkPixelRatio >= 0.6 && lightPixelRatio >= 0.04 && lightPixelRatio <= 0.4;
}

function excludeLikelyInvertedLines(lines: OCRLine[], image: HTMLCanvasElement) {
  const context = image.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return lines;
  }

  return lines.filter((line) => {
    if (line.left === undefined || line.width === undefined || line.top === undefined || !line.height) {
      return true;
    }

    const left = Math.max(0, Math.floor(line.left * image.width));
    const top = Math.max(0, Math.floor(line.top * image.height));
    const right = Math.min(image.width, Math.ceil((line.left + line.width) * image.width));
    const bottom = Math.min(image.height, top + Math.max(1, Math.ceil(line.height)));
    if (right <= left || bottom <= top) {
      return true;
    }

    const pixels = context.getImageData(left, top, right - left, bottom - top).data;
    let darkPixels = 0;
    let lightPixels = 0;
    const pixelCount = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      if (luminance < 80) {
        darkPixels += 1;
      } else if (luminance > 190) {
        lightPixels += 1;
      }
    }

    return !isLikelyInvertedTextRegion(darkPixels / pixelCount, lightPixels / pixelCount);
  });
}

export function extractShopName(lines: OCRLine[]) {
  const uniqueLineHeights = new Map<string, number>();
  for (const line of lines) {
    if (line.height && line.height > 0) {
      const compactText = cleanShopName(line.text).replace(/\s+/g, "");
      uniqueLineHeights.set(
        compactText,
        Math.max(uniqueLineHeights.get(compactText) ?? 0, line.height),
      );
    }
  }
  const baselineHeight = median([...uniqueLineHeights.values()]);

  const candidates = lines.flatMap((line, index) => {
    const text = cleanShopName(line.text);
    const compactText = text.replace(/\s+/g, "");
    const top = line.top ?? index / Math.max(lines.length, 1);
    if (!text || top > shopHeaderHeightRatio || datePattern.test(text) || findTotalKeyword(text)) {
      return [];
    }
    if (nonShopNameLine.test(compactText)) {
      return [];
    }
    if (/(?:TEL|〒|領収書|領収証|レシート|営業時間|ありがとうございました|お買い上げ|登録番号|適格請求書|担当|レジ|ポイント|クーポン|\d{2,4}[-ー]\d{2,4}|[都道府県市区町丁目番地])/i.test(compactText)) {
      return [];
    }
    if ((text.match(/[A-Za-zぁ-ゖァ-ヶ一-龯々〆ヵヶ]/g) ?? []).length < 2) {
      return [];
    }
    const hasShopCharacter = compactText.includes("店");
    const hasDistinctiveSize =
      line.height !== undefined &&
      (baselineHeight === 0 || line.height >= Math.max(baselineHeight * 1.3, 18));
    return [{ ...line, text, top, hasDistinctiveSize }];
  });

  if (candidates.length === 0) {
    return null;
  }

  const selected = candidates.sort((candidateA, candidateB) =>
    Number(candidateB.text.includes("店")) - Number(candidateA.text.includes("店")) ||
    Number(candidateB.hasDistinctiveSize) - Number(candidateA.hasDistinctiveSize) ||
    (candidateB.height ?? 0) - (candidateA.height ?? 0) ||
    candidateA.top - candidateB.top ||
    candidateB.confidence - candidateA.confidence,
  )[0].text;
  return selected.slice(0, 255);
}

type FieldCandidate<T extends string | number> = {
  value: T;
  confidence: number;
};

function selectFieldCandidate<T extends string | number>(
  candidates: Array<FieldCandidate<T> | null>,
) {
  const groups = new Map<string, FieldCandidate<T>[]>();
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const key = `${typeof candidate.value}:${candidate.value}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const rankedGroups = [...groups.values()].sort((groupA, groupB) =>
    groupB.length - groupA.length ||
    averageConfidence(groupB) - averageConfidence(groupA),
  );
  const selected = rankedGroups[0];
  if (!selected) {
    return { value: null, confidence: 0 };
  }

  const disagreementPenalty = rankedGroups.length > 1 ? 10 : 0;
  const agreementBonus = Math.min(15, (selected.length - 1) * 10);
  return {
    value: selected[0].value,
    confidence: Math.max(
      0,
      Math.min(100, Math.round(averageConfidence(selected) + agreementBonus - disagreementPenalty)),
    ),
  };
}

function averageConfidence(candidates: Array<{ confidence: number }>) {
  return candidates.reduce((total, candidate) => total + candidate.confidence, 0) / candidates.length;
}

function getShopNameCandidate(lines: OCRLine[]): FieldCandidate<string> | null {
  const value = extractShopName(lines);
  if (!value) {
    return null;
  }
  const compactName = cleanShopName(value).replace(/\s+/g, "");
  const confidence = Math.max(
    0,
    ...lines
      .filter((line) => cleanShopName(line.text).replace(/\s+/g, "").startsWith(compactName))
      .map((line) => line.confidence),
  );
  return { value, confidence };
}

function getDateCandidate(
  lines: OCRLine[],
  rawText: string,
  pageConfidence: number,
): FieldCandidate<string> | null {
  const lineCandidates = lines.flatMap((line) => {
    const value = extractPurchasedAt(line.text);
    return value ? [{ value, confidence: line.confidence }] : [];
  });
  if (lineCandidates.length > 0) {
    return lineCandidates.sort((candidateA, candidateB) =>
      candidateB.confidence - candidateA.confidence,
    )[0];
  }
  const value = extractPurchasedAt(rawText);
  return value ? { value, confidence: pageConfidence } : null;
}

function getTotalAmountCandidate(
  lines: OCRLine[],
  rawText: string,
  pageConfidence: number,
): FieldCandidate<number> | null {
  const candidates: Array<FieldCandidate<number> & { keywordPriority: number }> = [];
  for (const [index, line] of lines.entries()) {
    const keyword = findTotalKeyword(line.text);
    if (keyword) {
      const followingLine = lines[index + 1];
      const relatedLines = followingLine ? [line, followingLine] : [line];
      const value = extractTotalAmount(relatedLines.map(({ text }) => text).join("\n"));
      if (value !== null) {
        candidates.push({
          value,
          confidence: averageConfidence(relatedLines),
          keywordPriority: isExactTotalKeyword(keyword) ? 1 : 0,
        });
      }
    }
    if (/(?:%|％)\s*(?:対象|対|TH|T\s*H)/i.test(line.text)) {
      const value = extractTotalAmount(line.text);
      if (value !== null) {
        candidates.push({ value, confidence: line.confidence, keywordPriority: 0 });
      }
    }
  }

  if (candidates.length > 0) {
    return candidates.sort((candidateA, candidateB) =>
      candidateB.keywordPriority - candidateA.keywordPriority ||
      candidateB.confidence - candidateA.confidence,
    )[0];
  }

  const value = extractTotalAmount(rawText);
  if (value === null) {
    return null;
  }
  const amountLineConfidences = lines
    .filter((line) => !nonTotalAmountLine.test(line.text))
    .filter((line) => extractCurrencyAmounts(line.text).includes(value))
    .map((line) => line.confidence);
  return {
    value,
    confidence: amountLineConfidences.length > 0
      ? amountLineConfidences.reduce((total, lineConfidence) => total + lineConfidence, 0) /
        amountLineConfidences.length
      : pageConfidence,
  };
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((valueA, valueB) => valueA - valueB);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function extractPurchasedAt(rawText: string) {
  const match = datePattern.exec(normalizeOCRText(rawText));
  if (!match?.groups) {
    return null;
  }

  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function extractTotalAmount(rawText: string) {
  const lines = rawText.split(/\r?\n/).map(normalizeOCRText);

  for (const exactMatchOnly of [true, false]) {
    for (const [index, line] of lines.entries()) {
      const keywordMatch = findTotalKeyword(line);
      if (!keywordMatch || isExactTotalKeyword(keywordMatch) !== exactMatchOnly) {
        continue;
      }

      const afterKeyword = line.slice(keywordMatch.index + keywordMatch.text.length);
      const sameLineAmount = extractPrioritizedTotalAmount(afterKeyword);
      if (sameLineAmount !== null) {
        return sameLineAmount;
      }

      const nextLine = lines[index + 1];
      if (nextLine !== undefined && !nonTotalAmountLine.test(nextLine)) {
        const nextLineAmount = extractPrioritizedTotalAmount(nextLine);
        if (nextLineAmount !== null) {
          return nextLineAmount;
        }
      }
    }
  }

  for (const line of lines) {
    if (/(?:%|％)\s*(?:対象|対|TH|T\s*H)/i.test(line)) {
      const amounts = extractCurrencyAmounts(line);
      if (amounts.length > 0) {
        return Math.max(...amounts);
      }
    }
  }

  return extractRepeatedCurrencyAmount(lines);
}

export function toClientOCRResult(result: ReceiptOCRResult): ClientOCRResult {
  return {
    shop_name: result.shop_name,
    purchased_at: result.purchased_at,
    total_amount: result.total_amount,
    raw_ocr_text: result.raw_ocr_text,
    confidence: result.confidence,
    engine: result.engine,
  };
}

function cleanShopName(value: string) {
  const normalized = normalizeOCRText(value);
  const withoutLeadingNoise = normalized.replace(
    /^[^A-Za-zぁ-ゖァ-ヶ一-龯々〆ヵヶ0-9]+/,
    "",
  );
  return withoutLeadingNoise.replace(/\s+/g, " ").trim();
}

function normalizeOCRText(value: string) {
  return value.normalize("NFKC").replace(/=/g, "").trim();
}

function extractCurrencyAmounts(line: string) {
  return [...line.matchAll(currencyAmountPattern)]
    .map((match) => Number(match[1].replace(/[\s,.]/g, "")))
    .filter((amount) => Number.isSafeInteger(amount) && amount > 0);
}

function extractPrioritizedTotalAmount(value: string) {
  const sanitized = value
    .replace(
      /20\d{2}\s*(?:[\/.\-]|年)\s*\d{1,2}\s*(?:[\/.\-]|月)\s*\d{1,2}(?:\s*日)?/g,
      " ",
    )
    .replace(/\d{1,2}\s*:\s*\d{2}(?::\s*\d{2})?/g, " ")
    .replace(/\d+(?:\.\d+)?\s*[%％]/g, " ")
    .replace(/\d+\s*(?:点|個|品|件)/g, " ");

  const candidates = [
    ...extractAmountCandidates(sanitized, currencyAmountPattern, true),
    ...extractAmountCandidates(sanitized, plainAmountPattern, false),
  ].sort(
    (candidateA, candidateB) =>
      candidateA.start - candidateB.start ||
      Number(candidateB.hasCurrency) - Number(candidateA.hasCurrency),
  );

  const directlyAfterKeyword = candidates.find((candidate) =>
    /^[\s:：=＝\-ー—~～()（）[\]【】]*$/.test(
      sanitized.slice(0, candidate.start),
    ),
  );
  return (
    directlyAfterKeyword?.amount ??
    candidates.find((candidate) => candidate.hasCurrency)?.amount ??
    candidates[0]?.amount ??
    null
  );
}

function extractAmountCandidates(
  value: string,
  pattern: RegExp,
  hasCurrency: boolean,
) {
  return [...value.matchAll(pattern)].flatMap((match) => {
    const amount = Number(match[1].replace(/[\s,.]/g, ""));
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      hasInvalidAmountSuffix(value.slice(end))
    ) {
      return [];
    }
    return [{ amount, start, hasCurrency }];
  });
}

function hasInvalidAmountSuffix(value: string) {
  const suffix = value.trimStart();
  if (/^(?:点|個|品|件)/.test(suffix)) {
    return true;
  }
  return (
    /^[A-Za-zァ-ヶ一-龯々〆ヵヶ]/.test(suffix) &&
    !/^(?:円|税込|税)/.test(suffix)
  );
}

function extractRepeatedCurrencyAmount(lines: string[]) {
  const counts = new Map<number, number>();

  for (const line of lines) {
    if (nonTotalAmountLine.test(line)) {
      continue;
    }
    for (const amount of new Set(extractCurrencyAmounts(line))) {
      counts.set(amount, (counts.get(amount) ?? 0) + 1);
    }
  }

  const repeated = [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(([amountA, countA], [amountB, countB]) =>
      countB - countA || amountB - amountA,
    );

  return repeated[0]?.[0] ?? null;
}

export function calculateReceiptImageSize(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("画像の大きさを取得できませんでした。");
  }

  const maxSideScale = maxReceiptImageSide / Math.max(width, height);
  const pixelScale = Math.sqrt(maxReceiptImagePixels / (width * height));
  const scale = Math.min(1, maxSideScale, pixelScale);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function prepareReceiptImage(image: File, crop?: ReceiptImageCrop) {
  const bitmap = await createImageBitmap(image, {
    imageOrientation: "from-image",
  });
  const cropX = Math.max(0, Math.min(1, crop?.x ?? 0));
  const cropY = Math.max(0, Math.min(1, crop?.y ?? 0));
  const cropRight = Math.max(cropX, Math.min(1, (crop?.x ?? 0) + (crop?.width ?? 1)));
  const cropBottom = Math.max(cropY, Math.min(1, (crop?.y ?? 0) + (crop?.height ?? 1)));
  const sourceX = Math.floor(bitmap.width * cropX);
  const sourceY = Math.floor(bitmap.height * cropY);
  const sourceWidth = Math.max(1, Math.floor(bitmap.width * cropRight) - sourceX);
  const sourceHeight = Math.max(1, Math.floor(bitmap.height * cropBottom) - sourceY);
  const size = calculateReceiptImageSize(sourceWidth, sourceHeight);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("画像の前処理を開始できませんでした。");
  }

  try {
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } finally {
    bitmap.close();
  }

  return canvas;
}

function createReceiptHeaderImage(canvas: HTMLCanvasElement) {
  const header = document.createElement("canvas");
  header.width = canvas.width;
  header.height = Math.max(1, Math.floor(canvas.height * shopHeaderHeightRatio));
  const context = header.getContext("2d");
  if (!context) {
    throw new Error("画像の前処理を開始できませんでした。");
  }
  context.drawImage(
    canvas,
    0,
    0,
    canvas.width,
    header.height,
    0,
    0,
    header.width,
    header.height,
  );
  return header;
}

function enhanceReceiptImage(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("画像の前処理を開始できませんでした。");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const grayscale = new Uint8Array(pixels.length / 4);
  const histogram = new Uint32Array(256);
  for (let pixelIndex = 0; pixelIndex < grayscale.length; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const luminance = Math.round(
      pixels[index] * 0.299 +
      pixels[index + 1] * 0.587 +
      pixels[index + 2] * 0.114,
    );
    grayscale[pixelIndex] = luminance;
    histogram[luminance] += 1;
  }

  const low = findHistogramPercentile(histogram, grayscale.length, 0.02);
  const high = findHistogramPercentile(histogram, grayscale.length, 0.98);
  if (high <= low) {
    return;
  }

  const range = high - low;
  for (let pixelIndex = 0; pixelIndex < grayscale.length; pixelIndex += 1) {
    const index = pixelIndex * 4;
    const contrasted = Math.max(
      0,
      Math.min(255, Math.round(((grayscale[pixelIndex] - low) * 255) / range)),
    );
    pixels[index] = contrasted;
    pixels[index + 1] = contrasted;
    pixels[index + 2] = contrasted;
  }
  context.putImageData(imageData, 0, 0);
}

function findHistogramPercentile(
  histogram: Uint32Array,
  pixelCount: number,
  percentile: number,
) {
  const threshold = Math.ceil(pixelCount * percentile);
  let cumulative = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= threshold) {
      return value;
    }
  }
  return histogram.length - 1;
}
