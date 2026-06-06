import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { AuthMode, LoginForm, RegisterForm, User } from "../types";

type AuthPageProps = {
  mode: AuthMode;
  user: User | null;
  loginForm: LoginForm;
  registerForm: RegisterForm;
  message: string;
  error: string;
  isSubmitting: boolean;
  onLogin: () => Promise<boolean>;
  onRegister: () => Promise<boolean>;
  setLoginForm: Dispatch<SetStateAction<LoginForm>>;
  setRegisterForm: Dispatch<SetStateAction<RegisterForm>>;
};

export default function AuthPage({
  mode,
  loginForm,
  registerForm,
  message,
  error,
  isSubmitting,
  onLogin,
  onRegister,
  setLoginForm,
  setRegisterForm,
}: AuthPageProps) {
  const navigate = useNavigate();

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await onLogin();
    if (succeeded) {
      navigate("/home", { replace: true });
    }
  }

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const succeeded = await onRegister();
    if (succeeded) {
      navigate("/login", { replace: true });
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <h1>ためるん</h1>

        {message && <p className="notice">{message}</p>}
        {error && <p className="error">{error}</p>}

        <div className="tabs" role="tablist" aria-label="認証メニュー">
          <Link className={mode === "login" ? "active" : ""} to="/login">
            ログイン
          </Link>
          <Link className={mode === "register" ? "active" : ""} to="/register">
            新規登録
          </Link>
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
