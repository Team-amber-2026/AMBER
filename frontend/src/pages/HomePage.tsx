import { useNavigate } from "react-router-dom";

import type { DashboardSummary, User } from "../types";
import { formatCurrency } from "../utils/format";

const dashboardSummary: DashboardSummary = {
  totalAmount: 0,
  receiptCount: 0,
  recentExpenses: [],
};

type HomePageProps = {
  user: User;
  message: string;
  error: string;
  isSubmitting: boolean;
  onLogout: () => Promise<void>;
};

export default function HomePage({ user, message, error, isSubmitting, onLogout }: HomePageProps) {
  const navigate = useNavigate();

  return (
    <main className="app-shell">
      <header className="home-header">
        <div>
          <p className="eyebrow">ためるん</p>
          <h1>{user.username}さんのホーム</h1>
        </div>
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={onLogout}
          disabled={isSubmitting}
        >
          ログアウト
        </button>
      </header>

      {message && <p className="notice">{message}</p>}
      {error && <p className="error">{error}</p>}

      <section className="summary-panel" aria-labelledby="monthly-total-title">
        <div>
          <p className="eyebrow">今月の支出</p>
          <h2 id="monthly-total-title">{formatCurrency(dashboardSummary.totalAmount)}</h2>
          <p className="summary-note">登録された支出が月次合計に反映されます。</p>
        </div>
        <div className="receipt-count">
          <span>{dashboardSummary.receiptCount}</span>
          <small>件</small>
        </div>
      </section>

      <section className="primary-actions" aria-label="主な操作">
        <button type="button" className="scan-button" onClick={() => navigate("/receipts/new")}>
          <span className="button-icon" aria-hidden="true">
            +
          </span>
          レシートを登録
        </button>
        <button type="button" className="secondary-button" onClick={() => navigate("/expenses")}>
          支出一覧
        </button>
      </section>

      <section className="content-grid">
        <div className="section-block">
          <div className="section-heading">
            <h2>最近の支出</h2>
            <button type="button" className="text-button" onClick={() => navigate("/expenses")}>
              すべて見る
            </button>
          </div>

          {dashboardSummary.recentExpenses.length > 0 ? (
            <ul className="expense-list">
              {dashboardSummary.recentExpenses.map((expense) => (
                <li key={expense.id} className="expense-item">
                  <div>
                    <strong>{expense.shopName}</strong>
                    <span>
                      {expense.purchasedAt} / {expense.category}
                    </span>
                  </div>
                  <b>{formatCurrency(expense.totalAmount)}</b>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">
              <strong>まだ支出がありません</strong>
              <p>レシート登録ができるようになると、ここに直近の支出が表示されます。</p>
            </div>
          )}
        </div>

        <div className="section-block profile-block">
          <h2>アカウント</h2>
          <dl>
            <dt>ID</dt>
            <dd>{user.id}</dd>
            <dt>ユーザー名</dt>
            <dd>{user.username}</dd>
            <dt>メール</dt>
            <dd>{user.email || "-"}</dd>
          </dl>
        </div>
      </section>
    </main>
  );
}
