import { Navigate, useLocation, useNavigate } from "react-router-dom";

import type { SavedExpense } from "../types";
import { formatCurrency } from "../utils/format";
import styles from "./ReceiptCompletePage.module.css";

type LocationState = {
  expense?: SavedExpense;
};

export default function ReceiptCompletePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { expense } = (location.state ?? {}) as LocationState;

  if (!expense) return <Navigate to="/receipts/new" replace />;

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>保存完了</p>
          <h1>支出を保存しました</h1>
        </div>
      </header>

      <section className={styles.completePanel}>
        <div className={styles.checkMark} aria-hidden="true">
          ✓
        </div>
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
      </section>

      <section className={styles.actionRow} aria-label="保存後の操作">
        <button type="button" className={styles.primaryButton} onClick={() => navigate("/receipts/new", { replace: true })}>
          続けて登録
        </button>
        <button type="button" className={styles.buttonSecondary} onClick={() => navigate("/home", { replace: true })}>
          ホームへ戻る
        </button>
      </section>
    </main>
  );
}
