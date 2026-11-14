import { createWorker, OEM, PSM } from "tesseract.js";
import type { LoggerMessage, Worker } from "tesseract.js";

import type { ClientOCRResult, ReceiptOCRResult } from "../types";
import {
  createSerialTaskQueue,
  raceWithAbort,
} from "../utils/serialTaskQueue";

type ProgressListener = (message: LoggerMessage) => void;
type FieldCandidate<T> = { value: T | null; confidence: number };
type ReceiptCandidate<T> = {
  candidate: FieldCandidate<T>;
  fromHeader?: boolean;
};

export type ReceiptImageCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const totalKeywords = /(?:合\s*(?:計|言\s*[十ニ二])|言\s*[十ニ二]|お\s*買\s*上(?:げ)?\s*金\s*額|ご\s*請\s*求\s*額|現\s*計|総\s*額)/;
const datePattern = /(?<!\d)(?<year>20\d{2}|\d{2})\s*(?:\/|\.|-|年)\s*(?<month>\d{1,2})\s*(?:\/|\.|-|月)\s*(?<day>\d{1,2})(?:日)?(?!\d)/;
const currencyAmountPattern = /(?:¥|￥|\\|Y)\s*([0-9]{1,3}(?:[,.]\s?[0-9]{3})+|[0-9]+)/gi;
const plainAmountPattern = /(?<![0-9A-Za-z])([0-9]{1,3}(?:[,.]\s?[0-9]{3})+|[0-9]+)(?![0-9A-Za-z])/g;
const nonTotalAmountLine = /(?:現\s*金|お\s*預|預\s*り|釣|お\s*つ\s*り|消費\s*税|税\s*額|割引\s*前|小\s*計|前\s*合\s*計|税\s*抜(?:き)?|ポイント|マイル|残\s*高|獲\s*得|利用|使用|還\s*元|加\s*算)/;
const bareAmountLine = /^(?:[¥￥Y\\]\s*)?\d{1,3}(?:[,.]\s?\d{3})*(?:[,.]?\d+)?\s*(?:円)?(?:[※\-ー—~～])?$/;
const nonShopNameLine = /(?:単行本|領収書|領収証|レシート|商品名|品名|品目|明細|小計|税額|お預り|おつり|登録番号|適格請求書|[TＴ]\d{13}|ありがとう\s*ござい(?:ます|ました)?|(?:予め\s*)?ご了承ください(?:ませ)?|くださいませ)/;
// Keep enough pixels for small receipt characters. The previous 2200px limit
// could reduce a typical 3024x4032 phone photo to roughly 1650x2200.
const maxReceiptImageSide = 3200;
const maxReceiptImagePixels = 6_000_000;
const focusedReceiptImageSide = 4200;
const focusedReceiptImagePixels = 8_000_000;
const shopHeaderHeightRatio = 0.45;
const totalRegionStartRatio = 0.5;

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
        const offset =
          recognitionPass === 1 ? 0.05 :
          recognitionPass === 2 ? 0.24 :
          recognitionPass === 3 ? 0.43 :
          recognitionPass === 4 ? 0.62 :
          recognitionPass === 5 ? 0.76 :
          recognitionPass === 6 ? 0.87 : 0.93;
        progressListener?.({
          ...message,
          progress: Math.min(1, Math.max(0, offset + Math.min(1, Math.max(0, message.progress)) * 0.2)),
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
  let binaryImage: HTMLCanvasElement | null = null;
  let headerImage: HTMLCanvasElement | null = null;
  let invertedHeaderImage: HTMLCanvasElement | null = null;
  let focusedBodyImage: HTMLCanvasElement | null = null;
  let focusedTotalImage: HTMLCanvasElement | null = null;
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
          // Receipt text is usually arranged as one vertical column. SINGLE_BLOCK
          // tends to merge nearby lines, especially on narrow mobile photos.
          tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
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

    let binaryResult: Tesseract.RecognizeResult | null = null;
    try {
      // A separate binary pass helps with faint thermal-printer text and
      // uneven paper backgrounds without sacrificing the original pass.
      binaryImage = copyCanvas(preparedImage);
      binarizeReceiptImage(binaryImage);
      await raceWithAbort(
        worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
        signal,
      );
      recognitionPass = 3;
      binaryResult = await raceWithAbort(
        worker.recognize(binaryImage, {}, { text: true, blocks: true }),
        signal,
      );
      releaseReceiptCanvas(binaryImage);
      binaryImage = null;
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason ?? error;
      }
      // The original and grayscale passes remain usable if binarization fails.
    }

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
        // The header pass configures its own parameters below.
      }
    }
    throwIfAborted(signal);

    let headerResult: Tesseract.RecognizeResult | null = null;
    let invertedHeaderResult: Tesseract.RecognizeResult | null = null;
    try {
      // Re-read the header from the source image instead of the already
      // resized full receipt. This preserves logo and small branch-name pixels
      // on long receipts.
      headerImage = await prepareReceiptRegion(
        image,
        crop,
        { x: 0, y: 0, width: 1, height: shopHeaderHeightRatio },
        { maxSide: focusedReceiptImageSide, maxPixels: focusedReceiptImagePixels },
      );
      await raceWithAbort(
        worker.setParameters({
          tessedit_pageseg_mode: PSM.AUTO,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
        signal,
      );
      recognitionPass = 4;
      headerResult = await raceWithAbort(
        worker.recognize(headerImage, {}, { text: true, blocks: true }),
        signal,
      );

      // Store logos and names are sometimes white text inside a black label.
      // Tesseract is much more reliable after converting that negative text
      // into dark text on a light background.
      invertedHeaderImage = copyCanvas(headerImage);
      invertReceiptImage(invertedHeaderImage);
      binarizeReceiptImage(invertedHeaderImage);
      await raceWithAbort(
        worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          preserve_interword_spaces: "1",
          user_defined_dpi: "300",
        }),
        signal,
      );
      recognitionPass = 5;
      invertedHeaderResult = await raceWithAbort(
        worker.recognize(invertedHeaderImage, {}, { text: true, blocks: true }),
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
    const binaryText = binaryResult?.data.text.trim() ?? "";
    const headerText = headerResult?.data.text.trim() ?? "";
    const invertedHeaderText = invertedHeaderResult?.data.text.trim() ?? "";
    const originalLines = extractLines(originalResult.data, originalText, preparedImage.height);
    const enhancedLines = enhancedResult
      ? extractLines(enhancedResult.data, enhancedText, preparedImage.height)
      : [];
    const binaryLines = binaryResult
      ? extractLines(binaryResult.data, binaryText, preparedImage.height)
      : [];
    const headerLines = headerResult
      ? extractLines(
        headerResult.data,
        headerText,
        headerImage ? headerImage.height / shopHeaderHeightRatio : preparedImage.height,
        0,
        headerImage?.height ?? 0,
      )
      : [];
    const invertedHeaderLines = invertedHeaderResult
      ? extractLines(
        invertedHeaderResult.data,
        invertedHeaderText,
        invertedHeaderImage
          ? invertedHeaderImage.height / shopHeaderHeightRatio
          : preparedImage.height,
        0,
        invertedHeaderImage?.height ?? 0,
      )
      : [];
    releaseReceiptCanvas(headerImage);
    releaseReceiptCanvas(invertedHeaderImage);
    headerImage = null;
    invertedHeaderImage = null;
    let focusedBodyText = "";
    let focusedBodyLines: OCRLine[] = [];
    let focusedBodyConfidence = 0;
    if (shouldReanalyzeReceiptBody([originalLines, enhancedLines, binaryLines])) {
      try {
        focusedBodyImage = await prepareReceiptRegion(
          image,
          crop,
          { x: 0, y: 0.18, width: 1, height: 0.65 },
          { maxSide: focusedReceiptImageSide, maxPixels: focusedReceiptImagePixels },
        );
        await raceWithAbort(
          worker.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          }),
          signal,
        );
        recognitionPass = 6;
        const focusedBodyResult = await raceWithAbort(
          worker.recognize(focusedBodyImage, {}, { text: true, blocks: true }),
          signal,
        );
        focusedBodyText = focusedBodyResult.data.text.trim();
        focusedBodyConfidence = focusedBodyResult.data.confidence;
        focusedBodyLines = extractLines(
          focusedBodyResult.data,
          focusedBodyText,
          focusedBodyImage.height,
        ).map((line) => ({
          ...line,
          top: 0.18 + (line.top ?? 0) * 0.65,
        }));
        releaseReceiptCanvas(focusedBodyImage);
        focusedBodyImage = null;
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason ?? error;
        }
        // Keep the existing full-page OCR when the focused body pass fails.
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
            // The next OCR pass configures its own page segmentation mode.
          }
        }
      }
    }
    const baseRawText = chooseRawOcrText([
      { text: originalText, confidence: originalResult.data.confidence },
      ...(enhancedResult
        ? [{ text: enhancedText, confidence: enhancedResult.data.confidence }]
        : []),
      ...(binaryResult
        ? [{ text: binaryText, confidence: binaryResult.data.confidence }]
        : []),
    ]);
    // Add only product rows missing from the selected full-page pass. The
    // line-level deduplication keeps the focused pass from reintroducing the
    // duplicate receipt text that the UI previously showed.
    const rawText = mergeReceiptOcrText(
      baseRawText,
      focusedBodyLines.filter(isReceiptProductLine).map((line) => line.text),
    );
    const fullPageConfidences = [
      originalResult.data.confidence,
      ...(enhancedResult ? [enhancedResult.data.confidence] : []),
      ...(binaryResult ? [binaryResult.data.confidence] : []),
    ];
    const confidence = fullPageConfidences.reduce((sum, value) => sum + value, 0)
      / fullPageConfidences.length;
    // Candidate selection is field-specific. Agreement across independent
    // preprocessing passes is stronger evidence than one high OCR confidence
    // value, and header candidates get an explicit layout bonus for shop names.
    const shopCandidate = resolveReceiptFieldCandidate([
      { candidate: extractShopNameCandidate(originalLines) },
      ...(enhancedLines.length > 0
        ? [{ candidate: extractShopNameCandidate(enhancedLines) }]
        : []),
      ...(binaryLines.length > 0
        ? [{ candidate: extractShopNameCandidate(binaryLines) }]
        : []),
      ...(headerLines.length > 0
        ? [{ candidate: extractShopNameCandidate(headerLines), fromHeader: true }]
        : []),
      ...(invertedHeaderLines.length > 0
        ? [{ candidate: extractShopNameCandidate(invertedHeaderLines), fromHeader: true }]
        : []),
    ]);
    const dateCandidate = resolveReceiptFieldCandidate([
      { candidate: extractDateCandidate(originalText, originalLines, originalResult.data.confidence) },
      ...(enhancedResult
        ? [{ candidate: extractDateCandidate(enhancedText, enhancedLines, enhancedResult.data.confidence) }]
        : []),
      ...(binaryResult
        ? [{ candidate: extractDateCandidate(binaryText, binaryLines, binaryResult.data.confidence) }]
        : []),
      ...(focusedBodyText
        ? [{ candidate: extractDateCandidate(focusedBodyText, focusedBodyLines, focusedBodyConfidence) }]
        : []),
    ]);
    const totalCandidateEntries: ReceiptCandidate<number>[] = [
      { candidate: extractTotalCandidate(originalText, originalLines, originalResult.data.confidence) },
      ...(enhancedResult
        ? [{ candidate: extractTotalCandidate(enhancedText, enhancedLines, enhancedResult.data.confidence) }]
        : []),
      ...(binaryResult
        ? [{ candidate: extractTotalCandidate(binaryText, binaryLines, binaryResult.data.confidence) }]
        : []),
      ...(focusedBodyText
        ? [{ candidate: extractTotalCandidate(focusedBodyText, focusedBodyLines, focusedBodyConfidence) }]
        : []),
    ];
    let totalCandidate = resolveReceiptFieldCandidate(totalCandidateEntries);

    // Only pay for a high-resolution total pass when the full-page passes do
    // not agree or produce a weak candidate. The source crop is intentionally
    // created from the original file, not the resized full-page canvas.
    if (
      totalCandidate.value === null ||
      totalCandidate.confidence < 75 ||
      hasCandidateDisagreement(totalCandidateEntries)
    ) {
      try {
        focusedTotalImage = await prepareReceiptRegion(
          image,
          crop,
          { x: 0, y: totalRegionStartRatio, width: 1, height: 1 - totalRegionStartRatio },
          { maxSide: focusedReceiptImageSide, maxPixels: focusedReceiptImagePixels },
        );
        await raceWithAbort(
          worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            preserve_interword_spaces: "1",
            user_defined_dpi: "300",
          }),
          signal,
        );
        recognitionPass = 7;
        const focusedTotalResult = await raceWithAbort(
          worker.recognize(focusedTotalImage, {}, { text: true, blocks: true }),
          signal,
        );
        const focusedTotalText = focusedTotalResult.data.text.trim();
        const focusedTotalLines = extractLines(
          focusedTotalResult.data,
          focusedTotalText,
          focusedTotalImage.height,
        );
        releaseReceiptCanvas(focusedTotalImage);
        focusedTotalImage = null;
        totalCandidate = resolveReceiptFieldCandidate([
          ...totalCandidateEntries,
          {
            candidate: extractTotalCandidate(
              focusedTotalText,
              focusedTotalLines,
              focusedTotalResult.data.confidence,
            ),
          },
        ]);
      } catch (error) {
        if (signal?.aborted) {
          throw signal.reason ?? error;
        }
        // Keep the full-page candidate if the focused pass is unavailable.
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
            // The next OCR run configures the page segmentation mode again.
          }
        }
      }
    }

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
    if (binaryImage) {
      binaryImage.width = 0;
      binaryImage.height = 0;
    }
    if (headerImage) {
      headerImage.width = 0;
      headerImage.height = 0;
    }
    if (invertedHeaderImage) {
      invertedHeaderImage.width = 0;
      invertedHeaderImage.height = 0;
    }
    if (focusedBodyImage) {
      focusedBodyImage.width = 0;
      focusedBodyImage.height = 0;
    }
    if (focusedTotalImage) {
      focusedTotalImage.width = 0;
      focusedTotalImage.height = 0;
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

function releaseReceiptCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) {
    return;
  }
  canvas.width = 0;
  canvas.height = 0;
}

function chooseRawOcrText(candidates: Array<{ text: string; confidence: number }>) {
  const available = candidates.filter((candidate) => candidate.text.trim().length > 0);
  if (available.length === 0) {
    return "";
  }

  const scored = available.map((candidate, index) => ({
    candidate,
    index,
    score: scoreRawOcrText(candidate.text, candidate.confidence),
  })).sort((left, right) =>
    right.score - left.score || left.index - right.index,
  );
  return scored[0].candidate.text.trim();
}

function scoreRawOcrText(text: string, confidence: number) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const japaneseCount = (text.match(/[ぁ-ゖァ-ヶ一-龯々〆ヵヶ]/g) ?? []).length;
  const currencyCount = countReceiptCurrencyTokens([text]);
  const noiseCount = lines.filter((line) => /^[A-Za-z]{1,2}$/.test(line)).length;
  return (
    confidence * 0.65 +
    Math.min(24, lines.length * 1.4) +
    Math.min(24, japaneseCount * 0.12) +
    currencyCount * 5 -
    noiseCount * 8
  );
}

function countReceiptCurrencyTokens(texts: string[]) {
  return texts.reduce(
    (count, text) => count + (text.match(/(?:¥|￥|\\|Y)\s*[0-9]/gi)?.length ?? 0),
    0,
  );
}

export function shouldReanalyzeReceiptBody(lineSets: OCRLine[][]) {
  const availableSets = lineSets.filter((lines) => lines.length > 0);
  if (availableSets.length === 0) {
    return true;
  }

  const bodySets = availableSets.map((lines) => lines.filter(isReceiptBodyLine));
  const maxLineCount = Math.max(...bodySets.map((lines) => lines.length));
  const maxCurrencyCount = Math.max(
    ...bodySets.map((lines) => countReceiptCurrencyTokens(lines.map((line) => line.text))),
  );
  const maxProductRowCount = Math.max(
    ...bodySets.map((lines) => lines.filter(isReceiptProductLine).length),
  );

  // A page can contain many metadata/tax lines and still omit every product
  // name. Require at least one plausible product + amount row before skipping
  // the high-resolution body pass.
  return maxLineCount < 10 || maxCurrencyCount < 3 || maxProductRowCount === 0;
}

function isReceiptBodyLine(line: OCRLine) {
  return line.top === undefined || (line.top >= 0.18 && line.top <= 0.83);
}

function isReceiptProductLine(line: OCRLine) {
  if (!isReceiptBodyLine(line)) {
    return false;
  }
  const normalized = line.text.normalize("NFKC").trim();
  if (!normalized || totalKeywords.test(normalized)) {
    return false;
  }
  if (/(?:商品合計|値引合計|値引き|小計|お預り|おつり|消費税|内消費税|税率|対象|点数)/.test(normalized)) {
    return false;
  }

  const textWithoutAmounts = normalized
    .replace(currencyAmountPattern, " ")
    .replace(plainAmountPattern, " ")
    .replace(/[※*()（）\[\]【】%％:：=＝\\¥￥Y軽減税率対]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return textWithoutAmounts.length >= 2 &&
    /[A-Za-zぁ-ゖァ-ヶ一-龯々〆ヵヶ]/.test(textWithoutAmounts) &&
    extractCurrencyAmounts(normalized).length > 0;
}

export function mergeReceiptOcrText(baseText: string, supplementalLines: string[]) {
  const result = baseText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const supplementalLine of supplementalLines) {
    const line = supplementalLine.trim();
    if (!line || result.some((existingLine) => areSimilarReceiptLines(existingLine, line))) {
      continue;
    }
    result.push(line);
  }

  return result.join("\n");
}

function areSimilarReceiptLines(left: string, right: string) {
  const normalizedLeft = normalizeReceiptLine(left);
  const normalizedRight = normalizeReceiptLine(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  ) {
    return true;
  }

  const leftAmounts = extractCurrencyAmounts(left);
  const rightAmounts = extractCurrencyAmounts(right);
  const sharedAmount = leftAmounts.some((amount) => rightAmounts.includes(amount));
  if (!sharedAmount) {
    return false;
  }

  const leftName = normalizedLeft.replace(/\d+/g, "");
  const rightName = normalizedRight.replace(/\d+/g, "");
  return levenshteinDistance(leftName, rightName) <= Math.max(
    2,
    Math.floor(Math.min(leftName.length, rightName.length) * 0.2),
  );
}

function normalizeReceiptLine(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[^A-Za-z0-9ぁ-ゖァ-ヶ一-龯々〆ヵヶ]/g, "")
    .toLocaleLowerCase();
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

function resolveReceiptFieldCandidate<T extends string | number>(
  entries: ReceiptCandidate<T>[],
): FieldCandidate<T> {
  const groups = new Map<string, {
    value: T;
    confidences: number[];
    headerCount: number;
  }>();

  for (const entry of entries) {
    const candidate = entry.candidate;
    if (candidate.value === null) {
      continue;
    }
    const key = typeof candidate.value === "string"
      ? candidate.value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
      : String(candidate.value);
    const similarEntry = typeof candidate.value === "string"
      ? [...groups.entries()].find(([, group]) =>
        typeof group.value === "string" &&
        areSimilarShopCandidates(group.value, candidate.value as string),
      )
      : undefined;
    const similarGroup = similarEntry?.[1];
    const group = similarGroup ?? groups.get(key) ?? {
      value: candidate.value,
      confidences: [],
      headerCount: 0,
    };
    if (
      typeof group.value === "string" &&
      typeof candidate.value === "string"
    ) {
      group.value = preferShopRepresentation(group.value, candidate.value) as T;
    }
    group.confidences.push(candidate.confidence ?? 0);
    if (entry.fromHeader) {
      group.headerCount += 1;
    }
    groups.set(similarEntry?.[0] ?? key, group);
  }

  const ranked = [...groups.values()].map((group) => {
    const averageConfidence = group.confidences.reduce(
      (sum, confidence) => sum + confidence,
      0,
    ) / group.confidences.length;
    const supportCount = group.confidences.length;
    // Agreement is deliberately weighted more than a single confidence score.
    // This reduces the chance that one noisy pass wins over two consistent ones.
    const score =
      averageConfidence * 0.45 +
      supportCount * 32 +
      group.headerCount * 18;
    const calibratedConfidence = Math.min(
      100,
      Math.round(
        averageConfidence * 0.45 +
        Math.min(45, supportCount * 18) +
        Math.min(25, group.headerCount * 12),
      ),
    );
    return {
      value: group.value,
      confidence: calibratedConfidence,
      score,
    };
  }).sort((left, right) => right.score - left.score);

  const selected = ranked[0];
  return selected
    ? { value: selected.value, confidence: selected.confidence }
    : { value: null, confidence: 0 };
}

function hasCandidateDisagreement<T extends string | number>(entries: ReceiptCandidate<T>[]) {
  const values = new Set(
    entries
      .map(({ candidate }) => candidate.value)
      .filter((value): value is T => value !== null)
      .map((value) => typeof value === "string"
        ? value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
        : String(value)),
  );
  return values.size > 1;
}

export function extractShopNameCandidate(lines: OCRLine[]): FieldCandidate<string> {
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
    if (/(?:TEL|〒|領収書|領収証|レシート|商品名|品名|品目|明細|小計|税額|お預り|おつり|営業時間|ありがとうございました|お買い上げ|登録番号|適格請求書|担当|レジ|ポイント|クーポン|\d{2,4}[-ー]\d{2,4}|[都道府県市区町丁目番地])/i.test(compactText)) {
      return [];
    }
    if ((text.match(/[A-Za-zぁ-ゖァ-ヶ一-龯々〆ヵヶ]/g) ?? []).length < 2) {
      return [];
    }
    const hasShopCharacter = compactText.includes("店");
    const hasBranchSuffix = /(?:店|商店|ストア|マーケット|薬局|銀行)$/.test(compactText);
    const hasDistinctiveSize =
      line.height !== undefined &&
      line.height >= Math.max(baselineHeight * 1.3, 18);
    // Store names printed in the same size as item names are often returned
    // with a lower confidence. Do not discard them just because they have no
    // large font or the character "店". Position is handled in the score.
    if (line.confidence < 30) {
      return [];
    }

    const headerPositionScore = Math.max(
      0,
      34 * (1 - top / shopHeaderHeightRatio),
    );
    const hasReadableBranchLine = lines.some((otherLine) => {
      const otherText = cleanShopName(otherLine.text).replace(/\s+/g, "");
      return otherText !== compactText && isReadableBranchLine(otherText);
    });
    const looksLikeUnrelatedLogoText = /^[A-Za-z][A-Za-z0-9]{1,9}$/.test(compactText);
    const score =
      line.confidence +
      headerPositionScore +
      Number(hasShopCharacter) * 8 +
      Number(hasBranchSuffix) * 18 +
      Number(hasDistinctiveSize) * 5 -
      Number(looksLikeUnrelatedLogoText && hasReadableBranchLine) * 35;
    return [{ ...line, text, top, score }];
  });

  if (candidates.length === 0) {
    return { value: null, confidence: 0 };
  }

  const branchCandidate = [...candidates]
    .filter((candidate) => isReadableBranchLine(candidate.text.replace(/\s+/g, "")))
    .sort((candidateA, candidateB) => candidateA.top - candidateB.top)[0];
  const brandCandidate = [...candidates]
    .filter((candidate) => isLatinBrandLine(candidate.text))
    .sort((candidateA, candidateB) => candidateA.top - candidateB.top)[0];
  if (
    brandCandidate &&
    branchCandidate &&
    brandCandidate !== branchCandidate &&
    brandCandidate.top <= branchCandidate.top
  ) {
    return {
      value: `${brandCandidate.text} ${branchCandidate.text}`.slice(0, 255),
      confidence: Math.min(
        100,
        Math.round((brandCandidate.confidence + branchCandidate.confidence) / 2 + 8),
      ),
    };
  }

  // If the receipt uses one font size throughout, the first plausible line in
  // the header is a stronger signal than a later product line with a higher
  // OCR confidence. Give the first visual candidate a bounded bonus so that a
  // clearly higher-confidence header candidate can still win.
  const firstVisualCandidate = [...candidates].sort(
    (candidateA, candidateB) => candidateA.top - candidateB.top,
  )[0];
  if (firstVisualCandidate) {
    firstVisualCandidate.score += 30;
  }

  const selected = candidates.sort((candidateA, candidateB) =>
    candidateB.score - candidateA.score || candidateA.top - candidateB.top,
  )[0];
  return {
    value: selected.text.slice(0, 255),
    confidence: selected.confidence,
  };
}

function isReadableBranchLine(value: string) {
  return /[ぁ-ゖァ-ヶ一-龯々〆ヵヶ]/.test(value) &&
    /(?:店|商店|ストア|マーケット|薬局|銀行)$/.test(value);
}

function isLatinBrandLine(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const latinCharacters = normalized.match(/[A-Za-z]/g) ?? [];
  return latinCharacters.length >= 5 &&
    /^[A-Za-z][A-Za-z0-9&.'’ -]{4,}$/.test(normalized) &&
    !/(?:thank\s+you|receipt|register|total|subtotal)/i.test(normalized);
}

function areSimilarShopCandidates(left: string, right: string) {
  const leftBrand = getLatinBrandPart(left);
  const rightBrand = getLatinBrandPart(right);
  if (!leftBrand || !rightBrand) {
    return false;
  }

  const leftBranch = getBranchPart(left);
  const rightBranch = getBranchPart(right);
  if (leftBranch && rightBranch && leftBranch !== rightBranch) {
    return false;
  }

  return levenshteinDistance(leftBrand, rightBrand) <= 1;
}

function getLatinBrandPart(value: string) {
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const match = normalized.match(/^[A-Za-z][A-Za-z0-9&.'’ -]*/);
  const brand = match?.[0]?.trim() ?? "";
  return /[A-Za-z]/.test(brand) && brand.length >= 5 ? brand : "";
}

function getBranchPart(value: string) {
  const compact = value.normalize("NFKC").replace(/\s+/g, "");
  const match = compact.match(/[ぁ-ゖァ-ヶ一-龯々〆ヵヶ]+(?:店|商店|ストア|マーケット|薬局|銀行)$/);
  return match?.[0] ?? "";
}

function preferShopRepresentation(current: string, next: string) {
  const currentBranch = getBranchPart(current);
  const nextBranch = getBranchPart(next);
  if (nextBranch && !currentBranch) {
    return next;
  }
  if (currentBranch && !nextBranch) {
    return current;
  }
  return next.length > current.length ? next : current;
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + substitutionCost,
      ));
    }
    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }
  return previous[right.length];
}

export function choosePreferredShopNameCandidate(
  rawCandidates: FieldCandidate<string>[],
  fallbackCandidate?: FieldCandidate<string>,
): FieldCandidate<string> {
  const preferredRawCandidate = resolveFieldCandidate(rawCandidates);
  if (preferredRawCandidate.value === null) {
    return fallbackCandidate ?? { value: null, confidence: 0 };
  }
  if (!fallbackCandidate || fallbackCandidate.value === null) {
    return preferredRawCandidate;
  }

  const normalizedRaw = preferredRawCandidate.value.normalize("NFKC").replace(/\s+/g, "");
  const normalizedFallback = fallbackCandidate.value.normalize("NFKC").replace(/\s+/g, "");
  if (normalizedRaw === normalizedFallback) {
    return preferredRawCandidate;
  }

  // A header-only pass is especially valuable for inverse-color logos. Compare
  // layout support and confidence together instead of using confidence alone.
  const rawScore = preferredRawCandidate.confidence * 0.45 + 32;
  const headerScore = fallbackCandidate.confidence * 0.45 + 32 + 18;
  return headerScore > rawScore ? fallbackCandidate : preferredRawCandidate;
}

export function resolveFieldCandidate<T extends string | number>(
  candidates: FieldCandidate<T>[],
): FieldCandidate<T> {
  const groups = new Map<string, { value: T; confidences: number[] }>();
  for (const candidate of candidates) {
    if (candidate.value === null) {
      continue;
    }
    const key = typeof candidate.value === "string"
      ? candidate.value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()
      : String(candidate.value);
    const group = groups.get(key) ?? { value: candidate.value, confidences: [] };
    group.confidences.push(candidate.confidence ?? 0);
    groups.set(key, group);
  }

  const ranked = [...groups.values()].map(({ value, confidences }) => {
    const average = confidences.reduce((sum, current) => sum + current, 0) / confidences.length;
    return {
      value,
      confidence: Math.min(100, Math.round(average + 8 * (confidences.length - 1))),
      // Repeated agreement across independent OCR passes is stronger evidence
      // than a single high-confidence result.
      score: average + 32 * (confidences.length - 1),
    };
  }).sort((candidateA, candidateB) => candidateB.score - candidateA.score);

  const selected = ranked[0];
  return selected
    ? { value: selected.value, confidence: selected.confidence }
    : { value: null, confidence: 0 };
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

  const parsedYear = Number(match.groups.year);
  const year = parsedYear < 100 ? 2000 + parsedYear : parsedYear;
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
    confidence: value ? fallbackConfidence : 0,
  };
}

export function extractTotalCandidate(
  rawText: string,
  lines: OCRLine[],
  fallbackConfidence: number,
): FieldCandidate<number> {
  const value = extractTotalAmount(rawText);
  if (value === null) {
    return { value: null, confidence: 0 };
  }

  const explicitTotalConfidences = lines.flatMap((line, index) => {
    const normalizedText = line.text.normalize("NFKC");
    const keywordMatch = totalKeywords.exec(normalizedText);
    if (
      !keywordMatch ||
      hasNonMonetaryAggregatePrefix(normalizedText, keywordMatch.index) ||
      hasNonMonetaryAggregateSuffix(normalizedText, keywordMatch.index, keywordMatch[0].length)
    ) {
      return [];
    }

    const sameLineAmount = extractPrioritizedTotalAmount(normalizedText);
    if (sameLineAmount === value) {
      return [line.confidence];
    }

    const nextLine = lines[index + 1];
    if (!nextLine) {
      return [];
    }

    const nextLineText = nextLine.text.normalize("NFKC");
    if (isNonMonetaryTotalLine(nextLineText) || !bareAmountLine.test(nextLineText.trim())) {
      return [];
    }

    const nextLineAmount = extractPrioritizedTotalAmount(nextLineText);
    return nextLineAmount === value
      ? [Math.min(line.confidence, nextLine.confidence)]
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
  let selectedTotalAmount: number | null = null;

  for (const [index, line] of lines.entries()) {
    const keywordMatch = totalKeywords.exec(line);
    if (
      !keywordMatch ||
      hasNonMonetaryAggregatePrefix(line, keywordMatch.index) ||
      hasNonMonetaryAggregateSuffix(line, keywordMatch.index, keywordMatch[0].length)
    ) {
      continue;
    }

    const afterKeyword = line.slice(keywordMatch.index + keywordMatch[0].length);
    const sameLineAmount = extractPrioritizedTotalAmount(afterKeyword);
    if (sameLineAmount !== null) {
      selectedTotalAmount = sameLineAmount;
      continue;
    }

    const nextLine = lines[index + 1];
    if (nextLine !== undefined && !isNonMonetaryTotalLine(nextLine) && bareAmountLine.test(nextLine.trim())) {
      const nextLineAmount = extractPrioritizedTotalAmount(nextLine);
      if (nextLineAmount !== null) {
        selectedTotalAmount = nextLineAmount;
      }
    }
  }

  if (selectedTotalAmount !== null) {
    return selectedTotalAmount;
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

function hasNonMonetaryAggregatePrefix(value: string, keywordIndex: number) {
  const prefix = value.slice(0, keywordIndex);
  return /(?:商品|値引|割引|小\s*計|前\s*合\s*計|ポイント|マイル|残\s*高|獲\s*得|加\s*算|利用|使用|還\s*元)/i.test(prefix);
}

function hasNonMonetaryAggregateSuffix(value: string, keywordIndex: number, keywordLength: number) {
  const suffix = value.slice(keywordIndex + keywordLength).normalize("NFKC");
  const nonMonetaryMatch = suffix.match(/(?:ポイント|マイル|残\s*高|獲\s*得|加\s*算|利用|使用|還\s*元)/i);
  if (!nonMonetaryMatch || nonMonetaryMatch.index === undefined) {
    return false;
  }

  const prefixBeforeLabel = suffix.slice(0, nonMonetaryMatch.index);
  if (/[（(\[【]/.test(prefixBeforeLabel)) {
    return false;
  }

  const amountMatches = [
    ...suffix.matchAll(currencyAmountPattern),
    ...suffix.matchAll(plainAmountPattern),
  ].map((match) => ({
    match,
    index: match.index ?? 0,
    value: Number(match[1].replace(/[\s,.]/g, "")),
  }));
  const uniqueAmountMatches: typeof amountMatches = [];
  for (const item of amountMatches) {
    const duplicate = uniqueAmountMatches.some((candidate) =>
      candidate.value === item.value && Math.abs(candidate.index - item.index) <= 2,
    );
    if (!duplicate) {
      uniqueAmountMatches.push(item);
    }
  }
  const firstAmount = uniqueAmountMatches.sort((matchA, matchB) => matchA.index - matchB.index)[0];
  if (!firstAmount || nonMonetaryMatch.index > firstAmount.index) {
    return false;
  }

  return !uniqueAmountMatches.some((match) => match.index > firstAmount.index);
}

function isNonMonetaryTotalLine(value: string) {
  const normalized = value.normalize("NFKC");
  return /(?:ポイント|マイル|残\s*高|獲\s*得|加\s*算|利用|使用|還\s*元)/i.test(normalized)
    && /(?:合\s*計|計|総\s*額|金\s*額)/i.test(normalized);
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
      /(?:^|[\s:：=＝\-ー—~～()（）\[\]【】])(?:ポイント|マイル|残\s*高|獲\s*得|加\s*算|利用|使用|還\s*元)\s*(?=\d)/gi,
      " ",
    )
    .replace(
      /[（(\[]\s*(?:ポイント|マイル|残\s*高|獲\s*得|加\s*算|利用|使用|還\s*元)[^）\])\]]*[）\])\]]/gi,
      " ",
    )
    .replace(
      /20\d{2}\s*(?:[\/\.\-]|年)\s*\d{1,2}\s*(?:[\/\.\-]|月)\s*\d{1,2}(?:\s*日)?/g,
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
  return calculateReceiptImageSizeWithLimits(
    width,
    height,
    maxReceiptImageSide,
    maxReceiptImagePixels,
  );
}

type ReceiptImageRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ReceiptImageSizeLimits = {
  maxSide: number;
  maxPixels: number;
};

function calculateReceiptImageSizeWithLimits(
  width: number,
  height: number,
  maxSide: number,
  maxPixels: number,
) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("画像の大きさを取得できませんでした。");
  }

  const maxSideScale = maxSide / Math.max(width, height);
  const pixelScale = Math.sqrt(maxPixels / (width * height));
  const scale = Math.min(1, maxSideScale, pixelScale);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

async function prepareReceiptImage(image: File, crop?: ReceiptImageCrop) {
  return prepareReceiptRegion(
    image,
    crop,
    { x: 0, y: 0, width: 1, height: 1 },
    { maxSide: maxReceiptImageSide, maxPixels: maxReceiptImagePixels },
  );
}

async function prepareReceiptRegion(
  image: File,
  crop: ReceiptImageCrop | undefined,
  region: ReceiptImageRegion,
  limits: ReceiptImageSizeLimits,
) {
  const bitmap = await createImageBitmap(image, {
    imageOrientation: "from-image",
  });
  const cropX = Math.max(0, Math.min(1, crop?.x ?? 0));
  const cropY = Math.max(0, Math.min(1, crop?.y ?? 0));
  const cropWidth = Math.max(0, Math.min(1, crop?.width ?? 1));
  const cropHeight = Math.max(0, Math.min(1, crop?.height ?? 1));
  const regionX = Math.max(0, Math.min(1, region.x));
  const regionY = Math.max(0, Math.min(1, region.y));
  const regionRight = Math.max(regionX, Math.min(1, region.x + region.width));
  const regionBottom = Math.max(regionY, Math.min(1, region.y + region.height));
  const sourceLeftRatio = Math.min(1, cropX + cropWidth * regionX);
  const sourceTopRatio = Math.min(1, cropY + cropHeight * regionY);
  const sourceRightRatio = Math.min(1, cropX + cropWidth * regionRight);
  const sourceBottomRatio = Math.min(1, cropY + cropHeight * regionBottom);
  const sourceX = Math.floor(bitmap.width * sourceLeftRatio);
  const sourceY = Math.floor(bitmap.height * sourceTopRatio);
  const sourceWidth = Math.max(1, Math.floor(bitmap.width * sourceRightRatio) - sourceX);
  const sourceHeight = Math.max(1, Math.floor(bitmap.height * sourceBottomRatio) - sourceY);
  const size = calculateReceiptImageSizeWithLimits(
    sourceWidth,
    sourceHeight,
    limits.maxSide,
    limits.maxPixels,
  );
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

function copyCanvas(source: HTMLCanvasElement) {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  const context = copy.getContext("2d");
  if (!context) {
    throw new Error("画像の前処理を開始できませんでした。");
  }
  context.drawImage(source, 0, 0);
  return copy;
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

function binarizeReceiptImage(canvas: HTMLCanvasElement) {
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

  const threshold = findOtsuThreshold(histogram, grayscale.length);
  for (let pixelIndex = 0; pixelIndex < grayscale.length; pixelIndex += 1) {
    const value = grayscale[pixelIndex] <= threshold ? 0 : 255;
    const index = pixelIndex * 4;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
  }
  context.putImageData(imageData, 0, 0);
}

function invertReceiptImage(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("画像の前処理を開始できませんでした。");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 255 - pixels[index];
    pixels[index + 1] = 255 - pixels[index + 1];
    pixels[index + 2] = 255 - pixels[index + 2];
  }
  context.putImageData(imageData, 0, 0);
}

function findOtsuThreshold(histogram: Uint32Array, pixelCount: number) {
  let totalSum = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    totalSum += value * histogram[value];
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestThreshold = 127;
  let bestVariance = -1;
  for (let threshold = 0; threshold < histogram.length; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) {
      continue;
    }
    const foregroundWeight = pixelCount - backgroundWeight;
    if (foregroundWeight === 0) {
      break;
    }
    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
    const difference = backgroundMean - foregroundMean;
    const variance = backgroundWeight * foregroundWeight * difference * difference;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return bestThreshold;
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
