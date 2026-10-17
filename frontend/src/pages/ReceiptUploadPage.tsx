import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, PointerEvent } from "react";
import { useNavigate } from "react-router-dom";

import { saveExpense } from "../api/expenses";
import { runReceiptOcr, toClientOCRResult } from "../ocr/receiptOcr";
import type { ReceiptImageCrop } from "../ocr/receiptOcr";
import type { ExpenseSavePayload, ReceiptOCRResult } from "../types";
import { readableError } from "../utils/errors";
import styles from "./ReceiptUploadPage.module.css";

const maxImageSize = 10 * 1024 * 1024;
const lowConfidenceThreshold = 70;
const fullImageCrop: ReceiptImageCrop = { x: 0, y: 0, width: 1, height: 1 };
const minimumCropSize = 0.025;
const categories = ["食費", "日用品", "交通費", "医療費", "娯楽", "その他"];
const initialConfirmForm: ExpenseSavePayload = {
  shop_name: "",
  purchased_at: "",
  total_amount: 0,
  category: "その他",
  raw_ocr_text: "",
};

export default function ReceiptUploadPage() {
  const navigate = useNavigate();
  const saveInFlight = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisGenerationRef = useRef(0);
  const analysisControllerRef = useRef<AbortController | null>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);
  const cropDragRef = useRef<{
    x: number;
    y: number;
    previousCrop: ReceiptImageCrop;
  } | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [crop, setCrop] = useState<ReceiptImageCrop>(fullImageCrop);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<ReceiptOCRResult | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");
  const [confirmForm, setConfirmForm] = useState<ExpenseSavePayload>(initialConfirmForm);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      analysisGenerationRef.current += 1;
      analysisControllerRef.current?.abort();
      analysisControllerRef.current = null;
    };
  }, []);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    analysisGenerationRef.current += 1;
    analysisControllerRef.current?.abort();
    analysisControllerRef.current = null;
    resetAnalysis();
    setCrop(fullImageCrop);

    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setSelectedFile(null);
      setError("画像ファイルを選択してください。");
      return;
    }

    if (file.size > maxImageSize) {
      setSelectedFile(null);
      setError("画像サイズは10MB以下にしてください。");
      return;
    }

    setSelectedFile(file);
  }

  async function handleAnalyze() {
    if (!selectedFile) {
      setError("レシート画像を選択してください。");
      return;
    }

    const generation = analysisGenerationRef.current + 1;
    analysisGenerationRef.current = generation;
    analysisControllerRef.current?.abort();
    const controller = new AbortController();
    analysisControllerRef.current = controller;
    setIsAnalyzing(true);
    setError("");
    setMessage("");
    setResult(null);
    setOcrProgress(0);
    setOcrStatus("OCRを準備しています");

    try {
      const analyzedResult = await runReceiptOcr(
        selectedFile,
        ({ status, progress }) => {
          if (generation !== analysisGenerationRef.current) {
            return;
          }
          setOcrStatus(toJapaneseOcrStatus(status));
          setOcrProgress(progress);
        },
        controller.signal,
        crop,
      );
      if (generation !== analysisGenerationRef.current) {
        return;
      }

      setResult(analyzedResult);
      setConfirmForm({
        shop_name: analyzedResult.shop_name ?? "",
        purchased_at: analyzedResult.purchased_at ?? "",
        total_amount: analyzedResult.total_amount ?? 0,
        category: "その他",
        raw_ocr_text: analyzedResult.raw_ocr_text,
      });
      setOcrProgress(1);
      setMessage("読み取りが完了しました。内容を確認して保存してください。");
    } catch (requestError) {
      if (controller.signal.aborted) {
        return;
      }
      if (generation === analysisGenerationRef.current) {
        setError("読み取りに失敗しました。画像を選び直して、もう一度お試しください。");
      }
    } finally {
      if (analysisControllerRef.current === controller) {
        analysisControllerRef.current = null;
      }
      if (generation === analysisGenerationRef.current) {
        setIsAnalyzing(false);
      }
    }
  }

  async function handleSave() {
    if (saveInFlight.current) return;
    const validationError = validateConfirmForm(confirmForm);
    if (validationError) {
      setError(validationError);
      return;
    }

    saveInFlight.current = true;
    setIsSaving(true);
    setError("");
    setMessage("");

    try {
      const payload = result
        ? { ...confirmForm, ocr_result: toClientOCRResult(result) }
        : confirmForm;
      const savedExpense = await saveExpense(payload);
      navigate("/receipts/complete", { replace: true, state: { expense: savedExpense } });
    } catch (requestError) {
      saveInFlight.current = false;
      setIsSaving(false);
      setError(readableError(requestError));
    }
  }

  function resetAnalysis() {
    setIsAnalyzing(false);
    setResult(null);
    setConfirmForm(initialConfirmForm);
    setOcrProgress(0);
    setOcrStatus("");
    setMessage("");
    setError("");
  }

  function clearSelection() {
    analysisGenerationRef.current += 1;
    analysisControllerRef.current?.abort();
    analysisControllerRef.current = null;
    setSelectedFile(null);
    setCrop(fullImageCrop);
    resetAnalysis();
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function getCropPoint(clientX: number, clientY: number) {
    const bounds = cropFrameRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      return null;
    }
    return {
      x: Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (clientY - bounds.top) / bounds.height)),
    };
  }

  function updateCropDrag(clientX: number, clientY: number) {
    const start = cropDragRef.current;
    const point = getCropPoint(clientX, clientY);
    if (!start || !point) {
      return null;
    }
    const nextCrop = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    setCrop(nextCrop);
    return nextCrop;
  }

  function handleCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (isBusy) {
      return;
    }
    const point = getCropPoint(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    cropDragRef.current = { ...point, previousCrop: crop };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setCrop({ ...point, width: 0, height: 0 });
  }

  function handleCropPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!cropDragRef.current) {
      return;
    }
    const nextCrop = updateCropDrag(event.clientX, event.clientY);
    const previousCrop = cropDragRef.current.previousCrop;
    cropDragRef.current = null;
    if (!nextCrop || nextCrop.width < minimumCropSize || nextCrop.height < minimumCropSize) {
      setCrop(previousCrop);
    }
  }

  function handleCropPointerCancel() {
    const previousCrop = cropDragRef.current?.previousCrop;
    cropDragRef.current = null;
    if (previousCrop) {
      setCrop(previousCrop);
    }
  }

  const hasSelection = selectedFile !== null;
  const isBusy = isAnalyzing || isSaving;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>レシート登録</p>
          <h1>画像を選択して読み取り</h1>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.buttonSecondary} onClick={() => navigate("/home")} disabled={isSaving}>
            ホーム
          </button>
        </div>
      </header>

      {message && <p className={styles.notice}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}
      {result && Object.values(result.field_confidence).some((confidence) => confidence < lowConfidenceThreshold) && (
        <p className={styles.warning}>
          読み取り信頼度が低い項目があります。各項目をレシート画像と照合してください。
        </p>
      )}

      <section className={styles.uploadPanel} aria-label="レシート画像選択">
        <label className={styles.dropArea}>
          <span className={styles.dropIcon} aria-hidden="true">
            +
          </span>
          <strong>{hasSelection ? selectedFile.name : "レシート画像を選択"}</strong>
          <small>画像は読み取りにだけ使用し、保存しません。</small>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="レシート画像"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={isBusy}
          />
        </label>

        <div className={styles.previewPanel}>
          {previewUrl ? (
            <div
              ref={cropFrameRef}
              className={styles.cropFrame}
              onPointerDown={handleCropPointerDown}
              onPointerMove={(event) => updateCropDrag(event.clientX, event.clientY)}
              onPointerUp={handleCropPointerUp}
              onPointerCancel={handleCropPointerCancel}
            >
              <img
                src={previewUrl}
                alt="選択したレシート画像。ドラッグして読み取り範囲を指定できます"
                draggable={false}
              />
              <div
                className={styles.cropSelection}
                style={{
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                  height: `${crop.height * 100}%`,
                }}
                aria-hidden="true"
              />
              <button
                type="button"
                className={styles.resetCropButton}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setCrop(fullImageCrop)}
                disabled={isBusy}
              >
                全体を選択
              </button>
            </div>
          ) : (
            <div className={styles.emptyPreview}>
              <strong>プレビュー</strong>
              <span>選択した画像がここに表示されます。</span>
            </div>
          )}
        </div>
      </section>

      {hasSelection && (
        <p className={styles.cropHint}>
          画像上をドラッグしてOCR範囲を選択します。枠外は読み取りません。
        </p>
      )}

      <section className={styles.actionRow} aria-label="解析操作">
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleAnalyze}
          disabled={!hasSelection || isBusy}
        >
          {isAnalyzing ? "解析中..." : "OCR解析へ進む"}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={clearSelection}
          disabled={!hasSelection || isBusy}
        >
          選択を解除
        </button>
      </section>

      {isAnalyzing && (
        <section className={styles.loadingPanel} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <strong>{ocrStatus}</strong>
          <progress value={ocrProgress} max={1} aria-label="OCR解析の進捗" />
          <small>{Math.round(ocrProgress * 100)}%</small>
        </section>
      )}

      {result && (
        <section className={styles.resultPanel} aria-labelledby="receipt-result-title">
          <div className={styles.resultHeading}>
            <div>
              <p className={styles.eyebrow}>確認・修正</p>
              <h2 id="receipt-result-title">支出として保存</h2>
            </div>
            <span>
              {selectedFile?.name ?? "-"}
            </span>
          </div>

          <div className={styles.formGrid}>
            <label>
              店名
              <input
                type="text"
                aria-label="店名"
                value={confirmForm.shop_name}
                onChange={(event) =>
                  setConfirmForm((current) => ({ ...current, shop_name: event.target.value }))
                }
                placeholder="店名を入力"
              />
              <small className={getFieldConfidenceClass(result.field_confidence.shop_name)}>
                OCR信頼度 {Math.round(result.field_confidence.shop_name)}%
              </small>
              {getFieldReviewMessage(
                result.shop_name,
                result.field_confidence.shop_name,
                "店名",
              ) && (
                <small className={styles.fieldWarning}>
                  {getFieldReviewMessage(
                    result.shop_name,
                    result.field_confidence.shop_name,
                    "店名",
                  )}
                </small>
              )}
            </label>

            <label>
              購入日
              <input
                type="date"
                aria-label="購入日"
                value={confirmForm.purchased_at}
                onChange={(event) =>
                  setConfirmForm((current) => ({ ...current, purchased_at: event.target.value }))
                }
              />
              <small className={getFieldConfidenceClass(result.field_confidence.purchased_at)}>
                OCR信頼度 {Math.round(result.field_confidence.purchased_at)}%
              </small>
              {getFieldReviewMessage(
                result.purchased_at,
                result.field_confidence.purchased_at,
                "購入日",
              ) && (
                <small className={styles.fieldWarning}>
                  {getFieldReviewMessage(
                    result.purchased_at,
                    result.field_confidence.purchased_at,
                    "購入日",
                  )}
                </small>
              )}
            </label>

            <label>
              合計金額
              <input
                type="number"
                aria-label="合計金額"
                min="1"
                inputMode="numeric"
                value={confirmForm.total_amount || ""}
                onChange={(event) =>
                  setConfirmForm((current) => ({
                    ...current,
                    total_amount: Number(event.target.value),
                  }))
                }
                placeholder="0"
              />
              <small className={getFieldConfidenceClass(result.field_confidence.total_amount)}>
                OCR信頼度 {Math.round(result.field_confidence.total_amount)}%
              </small>
              {getFieldReviewMessage(
                result.total_amount,
                result.field_confidence.total_amount,
                "合計金額",
              ) && (
                <small className={styles.fieldWarning}>
                  {getFieldReviewMessage(
                    result.total_amount,
                    result.field_confidence.total_amount,
                    "合計金額",
                  )}
                </small>
              )}
            </label>

            <label>
              カテゴリー
              <select
                value={confirmForm.category}
                onChange={(event) =>
                  setConfirmForm((current) => ({ ...current, category: event.target.value }))
                }
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.fullWidth}>
              OCR全文
              <textarea
                value={confirmForm.raw_ocr_text}
                onChange={(event) =>
                  setConfirmForm((current) => ({ ...current, raw_ocr_text: event.target.value }))
                }
                rows={5}
                placeholder="OCRで読み取った全文"
              />
            </label>
          </div>

          <button
            type="button"
            className={styles.saveButton}
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? "保存中..." : "支出として保存"}
          </button>
        </section>
      )}
    </main>
  );
}

function validateConfirmForm(form: ExpenseSavePayload) {
  if (!form.purchased_at) {
    return "購入日を入力してください。";
  }

  if (!Number.isInteger(form.total_amount) || form.total_amount <= 0) {
    return "合計金額は1円以上の半角数字で入力してください。";
  }

  if (!form.category.trim()) {
    return "カテゴリーを選択してください。";
  }

  return "";
}

function getFieldReviewMessage(
  value: string | number | null,
  confidence: number,
  fieldName: string,
) {
  if (value === null || value === "") {
    return `${fieldName}を読み取れませんでした。画像を確認して入力してください。`;
  }
  if (confidence < lowConfidenceThreshold) {
    return `${fieldName}の読み取りに不確実さがあります。画像で確認してください。`;
  }
  return "";
}

function getFieldConfidenceClass(confidence: number) {
  return confidence < lowConfidenceThreshold ? styles.fieldWarning : styles.fieldConfidence;
}

function toJapaneseOcrStatus(status: string) {
  const labels: Record<string, string> = {
    "loading tesseract core": "OCRエンジンを読み込んでいます",
    "initializing tesseract": "OCRエンジンを初期化しています",
    "loading language traineddata": "日本語・英語モデルを読み込んでいます",
    "initializing api": "文字認識を準備しています",
    "recognizing text": "レシートの文字を読み取っています",
  };
  return labels[status] ?? "OCRを準備しています";
}
