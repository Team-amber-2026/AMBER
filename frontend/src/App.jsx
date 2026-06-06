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

  if (!authChecked) {
    return <main className="auth-shell">読み込み中...</main>;
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <h1>ためるん</h1>

        {message && <p className="notice">{message}</p>}
        {error && <p className="error">{error}</p>}

        {user ? (
          <div className="user-box">
            <dl>
              <dt>ID</dt>
              <dd>{user.id}</dd>
              <dt>ユーザー名</dt>
              <dd>{user.username}</dd>
              <dt>メール</dt>
              <dd>{user.email || "-"}</dd>
            </dl>
            <button type="button" onClick={handleLogout} disabled={isSubmitting}>
              ログアウト
            </button>
          </div>
        ) : (
          <>
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
          </>
        )}
      </section>
    </main>
  );
}
