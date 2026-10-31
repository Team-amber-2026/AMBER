import { createWorker, OEM, PSM } from "tesseract.js";
import type { LoggerMessage, Worker } from "tesseract.js";

import type { ClientOCRResult, ReceiptOCRResult } from "../types";
import {
  createSerialTaskQueue,
  raceWithAbort,
} from "../utils/serialTaskQueue";

type ProgressListener = (message: LoggerMessage) => void;
type FieldCandidate<T> = { value: T | null; confidence: number | null };

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
    const extractionText = [enhancedText, originalText].filter(Boolean).join("\n");
    const originalLines = extractLines(originalResult.data, originalText, preparedImage.height);
    const enhancedLines = enhancedResult
      ? extractLines(enhancedResult.data, enhancedText, preparedImage.height)
      : [];
    const headerLines = headerResult
      ? extractLines(headerResult.data, headerText, preparedImage.height, 0, headerImage?.height ?? 0)
      : [];
    const rawText = enhancedText.length > originalText.length ? enhancedText : originalText;
    const confidence = enhancedResult
      ? (originalResult.data.confidence + enhancedResult.data.confidence) / 2
      : originalResult.data.confidence;
    const shopCandidate = resolveFieldCandidate([
      extractShopNameCandidate(originalLines),
      ...enhancedLines.length > 0 ? [extractShopNameCandidate(enhancedLines)] : [],
      ...headerLines.length > 0 ? [extractShopNameCandidate(headerLines)] : [],
    ]);
    const dateCandidate = resolveFieldCandidate([
      extractDateCandidate(originalText, originalLines, originalResult.data.confidence),
      ...(enhancedResult
        ? [extractDateCandidate(enhancedText, enhancedLines, enhancedResult.data.confidence)]
        : []),
    ]);
    const totalCandidate = resolveFieldCandidate([
      extractTotalCandidate(originalText, originalLines, originalResult.data.confidence),
      ...(enhancedResult
        ? [extractTotalCandidate(enhancedText, enhancedLines, enhancedResult.data.confidence)]
        : []),
    ]);

    return {
      shop_name: shopCandidate.value,
      purchased_at: dateCandidate.value,
      total_amount: totalCandidate.value,
      raw_ocr_text: rawText,
      confidence,
      field_confidence: {
        shop_name: shopCandidate.confidence,
        purchased_at: dateCandidate.confidence,
        total_amount: totalCandidate.confidence,
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
};

function extractLines(
  data: Tesseract.Page,
  rawText: string,
  pageHeight: number,
  yOffset = 0,
  regionHeight = pageHeight,
): OCRLine[] {
  const detectedLines =
    data.blocks?.flatMap((block) =>
      block.paragraphs.flatMap((paragraph) =>
        paragraph.lines.map((line) => ({
          text: line.text.trim(),
          confidence: line.confidence,
          top: (yOffset + line.bbox.y0) / pageHeight,
          height: line.bbox.y1 - line.bbox.y0,
        })),
      ),
    ) ?? [];

  if (detectedLines.length > 0) {
    return detectedLines.filter((line) => line.text.length > 0);
  }

  const rawLines = rawText
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter((line) => line.length > 0);
  return rawLines.map((line, index) => ({
    text: line,
    confidence: data.confidence,
    top: (yOffset + (index / Math.max(rawLines.length, 1)) * regionHeight) / pageHeight,
  }));
}

export function extractShopName(lines: OCRLine[]) {
  return extractShopNameCandidate(lines).value;
}

function extractShopNameCandidate(lines: OCRLine[]): FieldCandidate<string> {
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
    if (!text || top > shopHeaderHeightRatio || datePattern.test(text) || totalKeywords.test(text)) {
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
      line.height >= Math.max(baselineHeight * 1.3, 18);
    if (!hasShopCharacter && !hasDistinctiveSize && line.confidence < 45) {
      return [];
    }
    const score =
      line.confidence +
      Number(hasShopCharacter) * 15 +
      Number(hasDistinctiveSize) * 10 -
      top * 15;
    return [{ ...line, text, top, score }];
  });

  if (candidates.length === 0) {
    return { value: null, confidence: null };
  }

  const selected = candidates.sort((candidateA, candidateB) =>
    candidateB.score - candidateA.score || candidateA.top - candidateB.top,
  )[0];
  return {
    value: selected.text.slice(0, 255),
    confidence: selected.confidence,
  };
}

export function resolveFieldCandidate<T extends string | number>(
  candidates: FieldCandidate<T>[],
): FieldCandidate<T> {
  const groups = new Map<T, number[]>();
  for (const candidate of candidates) {
    if (candidate.value === null) {
      continue;
    }
    const confidences = groups.get(candidate.value) ?? [];
    confidences.push(candidate.confidence ?? 0);
    groups.set(candidate.value, confidences);
  }

  const ranked = [...groups.entries()].map(([value, confidences]) => {
    const average = confidences.reduce((sum, current) => sum + current, 0) / confidences.length;
    return {
      value,
      confidence: Math.min(100, Math.round(average + 8 * (confidences.length - 1))),
      score: average + 15 * (confidences.length - 1),
    };
  }).sort((candidateA, candidateB) => candidateB.score - candidateA.score);

  const selected = ranked[0];
  return selected
    ? { value: selected.value, confidence: selected.confidence }
    : { value: null, confidence: null };
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
  const match = datePattern.exec(rawText);
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

function extractDateCandidate(
  rawText: string,
  lines: OCRLine[],
  fallbackConfidence: number,
): FieldCandidate<string> {
  const lineCandidates = lines.flatMap((line) => {
    const value = extractPurchasedAt(line.text);
    if (!value) {
      return [];
    }
    const top = line.top ?? 1;
    return [{
      value,
      confidence: line.confidence,
      score: line.confidence + (top < 0.55 ? 8 : 0) - top * 12,
    }];
  }).sort((candidateA, candidateB) => candidateB.score - candidateA.score);

  const selected = lineCandidates[0];
  if (selected) {
    return { value: selected.value, confidence: selected.confidence };
  }
  const value = extractPurchasedAt(rawText);
  return {
    value,
    confidence: value ? fallbackConfidence : null,
  };
}

function extractTotalCandidate(
  rawText: string,
  lines: OCRLine[],
  fallbackConfidence: number,
): FieldCandidate<number> {
  const value = extractTotalAmount(rawText);
  if (value === null) {
    return { value: null, confidence: null };
  }

  const explicitTotalConfidences = lines.flatMap((line, index) => {
    const normalizedText = line.text.normalize("NFKC");
    if (!totalKeywords.test(normalizedText)) {
      return [];
    }
    const nextLine = lines[index + 1];
    const amount = extractTotalAmount(
      nextLine ? `${normalizedText}\n${nextLine.text}` : normalizedText,
    );
    return amount === value
      ? [nextLine ? Math.min(line.confidence, nextLine.confidence) : line.confidence]
      : [];
  });
  if (explicitTotalConfidences.length > 0) {
    return { value, confidence: Math.max(...explicitTotalConfidences) };
  }

  const amountConfidence = lines
    .filter((line) => extractCurrencyAmounts(line.text.normalize("NFKC")).includes(value))
    .reduce((best, line) => Math.max(best, line.confidence), 0);
  return {
    value,
    confidence: amountConfidence > 0
      ? Math.round(amountConfidence * 0.75)
      : Math.round(fallbackConfidence * 0.65),
  };
}

export function extractTotalAmount(rawText: string) {
  const lines = rawText.split(/\r?\n/).map((line) => line.normalize("NFKC"));

  for (const [index, line] of lines.entries()) {
    const keywordMatch = totalKeywords.exec(line);
    if (!keywordMatch) {
      continue;
    }

    const afterKeyword = line.slice(keywordMatch.index + keywordMatch[0].length);
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
  const { field_confidence: _fieldConfidence, ...clientResult } = result;
  return clientResult;
}

function cleanShopName(value: string) {
  const normalized = value.normalize("NFKC").trim();
  const withoutLeadingNoise = normalized.replace(
    /^[^A-Za-zぁ-ゖァ-ヶ一-龯々〆ヵヶ0-9]+/,
    "",
  );
  return withoutLeadingNoise.replace(/\s+/g, " ").trim();
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
