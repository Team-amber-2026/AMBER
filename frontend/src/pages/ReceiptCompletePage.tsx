import { useLocation, useNavigate } from "react-router-dom";

import type { SavedExpense } from "../types";
import { formatCurrency } from "../utils/format";
import styles from "./ReceiptCompletePage.module.css";

type ReceiptCompletePageProps = {
  onLogout: () => Promise<void>;
  isSubmitting: boolean;
};

type LocationState = {
  expense?: SavedExpense;
};

export default function ReceiptCompletePage({ onLogout, isSubmitting }: ReceiptCompletePageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { expense } = (location.state ?? {}) as LocationState;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>保存完了</p>
          <h1>支出を保存しました</h1>
        </div>
        <button
          type="button"
          className={styles.buttonSecondary}
          onClick={onLogout}
          disabled={isSubmitting}
        >
          ログアウト
        </button>
      </header>

      <section className={styles.completePanel}>
        <div className={styles.checkMark} aria-hidden="true">
          ✓
        </div>
        {expense ? (
          <dl className={styles.summaryList}>
            <dt>店名</dt>
            <dd>{expense.shop_name || "未入力"}</dd>
            <dt>購入日</dt>
            <dd>{expense.purchased_at}</dd>
            <dt>合計金額</dt>
            <dd>{formatCurrency(expense.total_amount)}</dd>
            <dt>カテゴリー</dt>
            <dd>{expense.category}</dd>
          </dl>
        ) : (
          <p>保存済みの支出は、支出一覧から確認できます。</p>
        )}
      </section>

      <section className={styles.actionRow} aria-label="保存後の操作">
        <button type="button" className={styles.primaryButton} onClick={() => navigate("/receipts/new")}>
          続けて登録
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => navigate("/home")}>
          ホームへ戻る
        </button>
      </section>
    </main>
  );
}
