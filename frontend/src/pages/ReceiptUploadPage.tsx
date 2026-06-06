import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";

import { analyzeReceiptImage } from "../api/receipts";
import type { ReceiptAnalyzeResult } from "../types";
import { readableError } from "../utils/errors";
import styles from "./ReceiptUploadPage.module.css";

const maxImageSize = 10 * 1024 * 1024;

type ReceiptUploadPageProps = {
  onLogout: () => Promise<void>;
  isSubmitting: boolean;
};

export default function ReceiptUploadPage({ onLogout, isSubmitting }: ReceiptUploadPageProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [result, setResult] = useState<ReceiptAnalyzeResult | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setResult(null);
    setMessage("");
    setError("");

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

    setIsAnalyzing(true);
    setError("");
    setMessage("");
    setResult(null);

    try {
      const analyzedResult = await analyzeReceiptImage(selectedFile);
      setResult(analyzedResult);
      setMessage(analyzedResult.detail ?? "画像をアップロードしました。");
    } catch (requestError) {
      setError(readableError(requestError));
    } finally {
      setIsAnalyzing(false);
    }
  }

  function clearSelection() {
    setSelectedFile(null);
    setResult(null);
    setMessage("");
    setError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  const hasSelection = selectedFile !== null;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>レシート登録</p>
          <h1>画像をアップロード</h1>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.buttonSecondary} onClick={() => navigate("/home")}>
            ホーム
          </button>
          <button
            type="button"
            className={styles.buttonSecondary}
            onClick={onLogout}
            disabled={isSubmitting || isAnalyzing}
          >
            ログアウト
          </button>
        </div>
      </header>

      {message && <p className={styles.notice}>{message}</p>}
      {error && <p className={styles.error}>{error}</p>}

      <section className={styles.uploadPanel} aria-label="レシート画像アップロード">
        <label className={styles.dropArea}>
          <span className={styles.dropIcon} aria-hidden="true">
            +
          </span>
          <strong>{hasSelection ? selectedFile.name : "レシート画像を選択"}</strong>
          <small>スマホではカメラ起動、PCでは画像ファイル選択に対応しています。</small>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
          />
        </label>

        <div className={styles.previewPanel}>
          {previewUrl ? (
            <img src={previewUrl} alt="選択したレシート画像のプレビュー" />
          ) : (
            <div className={styles.emptyPreview}>
              <strong>プレビュー</strong>
              <span>選択した画像がここに表示されます。</span>
            </div>
          )}
        </div>
      </section>

      <section className={styles.actionRow} aria-label="解析操作">
        <button
          type="button"
          className={styles.primaryButton}
          onClick={handleAnalyze}
          disabled={!hasSelection || isAnalyzing}
        >
          {isAnalyzing ? "解析中..." : "OCR解析へ進む"}
        </button>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={clearSelection}
          disabled={!hasSelection || isAnalyzing}
        >
          選択を解除
        </button>
      </section>

      {isAnalyzing && (
        <section className={styles.loadingPanel} aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <strong>画像を送信しています</strong>
        </section>
      )}

      {result && (
        <section className={styles.resultPanel} aria-labelledby="receipt-result-title">
          <h2 id="receipt-result-title">解析結果</h2>
          <dl className={styles.resultList}>
            <dt>店名</dt>
            <dd>{result.shop_name ?? "未取得"}</dd>
            <dt>購入日</dt>
            <dd>{result.purchased_at ?? "未取得"}</dd>
            <dt>合計金額</dt>
            <dd>{result.total_amount ?? "未取得"}</dd>
            <dt>ファイル</dt>
            <dd>{result.image?.name ?? selectedFile?.name ?? "-"}</dd>
          </dl>
        </section>
      )}
    </main>
  );
}
