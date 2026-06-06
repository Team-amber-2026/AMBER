import { useEffect, useState } from "react";

import { fetchCurrentUser, loginUser, logoutUser, registerUser } from "./api/auth";

const initialLogin = {
  username: "",
  password: "",
};

const initialRegister = {
  username: "",
  email: "",
  password: "",
};

const dashboardSummary = {
  totalAmount: 0,
  receiptCount: 0,
  recentExpenses: [],
};

function formatCurrency(amount) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(amount);
}

function readableError(error) {
  const data = error.response?.data;
  if (!data) {
    return "通信に失敗しました。Djangoサーバーが起動しているか確認してください。";
  }
  if (typeof data.detail === "string") {
    return data.detail;
  }
  if (typeof data === "object") {
    return Object.entries(data)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\n");
  }
  return "処理に失敗しました。";
}

function HomeScreen({ user, message, error, isSubmitting, onLogout, onNextFeature }) {
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
        <button type="button" className="scan-button" onClick={onNextFeature}>
          <span className="button-icon" aria-hidden="true">
            +
          </span>
          レシートを登録
        </button>
        <button type="button" className="secondary-button" onClick={onNextFeature}>
          支出一覧
        </button>
      </section>

      <section className="content-grid">
        <div className="section-block">
          <div className="section-heading">
            <h2>最近の支出</h2>
            <button type="button" className="text-button" onClick={onNextFeature}>
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

export default function App() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [mode, setMode] = useState("login");
  const [loginForm, setLoginForm] = useState(initialLogin);
  const [registerForm, setRegisterForm] = useState(initialRegister);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function initializeAuth() {
      try {
        const currentUser = await fetchCurrentUser();
        setUser(currentUser);
      } catch (requestError) {
        if (requestError.response?.status !== 403 && requestError.response?.status !== 401) {
          setError(readableError(requestError));
        }
      } finally {
        setAuthChecked(true);
      }
    }

    initializeAuth();
  }, []);

  async function handleRegister(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      await registerUser(registerForm);
      setRegisterForm(initialRegister);
      setMode("login");
      setMessage("登録が完了しました。ログインしてください。");
    } catch (requestError) {
      setError(readableError(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const loggedInUser = await loginUser(loginForm);
      setUser(loggedInUser);
      setLoginForm(initialLogin);
      setMessage("ログインしました。");
    } catch (requestError) {
      setError(readableError(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      await logoutUser();
      setUser(null);
      setMessage("ログアウトしました。");
    } catch (requestError) {
      setError(readableError(requestError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleNextFeature() {
    setError("");
    setMessage("次はレシート画像アップロード画面を追加します。");
  }

  if (!authChecked) {
    return <main className="auth-shell">読み込み中...</main>;
  }

  if (user) {
    return (
      <HomeScreen
        user={user}
        message={message}
        error={error}
        isSubmitting={isSubmitting}
        onLogout={handleLogout}
        onNextFeature={handleNextFeature}
      />
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <h1>ためるん</h1>

        {message && <p className="notice">{message}</p>}
        {error && <p className="error">{error}</p>}

        <div className="tabs" role="tablist" aria-label="認証メニュー">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >
            ログイン
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >
            新規登録
          </button>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin}>
            <label htmlFor="login-username">ユーザー名またはメールアドレス</label>
            <input
              id="login-username"
              value={loginForm.username}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, username: event.target.value }))
              }
              required
            />

            <label htmlFor="login-password">パスワード</label>
            <input
              id="login-password"
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              required
            />

            <button type="submit" disabled={isSubmitting}>
              ログイン
            </button>
          </form>
        ) : (
          <form onSubmit={handleRegister}>
            <label htmlFor="register-username">ユーザー名</label>
            <input
              id="register-username"
              value={registerForm.username}
              onChange={(event) =>
                setRegisterForm((current) => ({ ...current, username: event.target.value }))
              }
              required
            />

            <label htmlFor="register-email">メールアドレス</label>
            <input
              id="register-email"
              type="email"
              value={registerForm.email}
              onChange={(event) =>
                setRegisterForm((current) => ({ ...current, email: event.target.value }))
              }
              required
            />

            <label htmlFor="register-password">パスワード</label>
            <input
              id="register-password"
              type="password"
              value={registerForm.password}
              onChange={(event) =>
                setRegisterForm((current) => ({ ...current, password: event.target.value }))
              }
              required
            />

            <button type="submit" disabled={isSubmitting}>
              登録
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
