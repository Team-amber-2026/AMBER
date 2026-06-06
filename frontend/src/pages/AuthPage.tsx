import type { Dispatch, FormEvent, SetStateAction } from "react";
import { Link, useNavigate } from "react-router-dom";

import type { AuthMode, LoginForm, RegisterForm, User } from "../types";
import styles from "./AuthPage.module.css";

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
    <main className={styles.shell}>
      <section className={styles.panel}>
        <h1>ためるん</h1>

        {message && <p className={styles.notice}>{message}</p>}
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.tabs} role="tablist" aria-label="認証メニュー">
          <Link
            className={`${styles.tab} ${mode === "login" ? styles.activeTab : ""}`}
            to="/login"
          >
            ログイン
          </Link>
          <Link
            className={`${styles.tab} ${mode === "register" ? styles.activeTab : ""}`}
            to="/register"
          >
            新規登録
          </Link>
        </div>

        {mode === "login" ? (
          <form className={styles.form} onSubmit={handleLogin}>
            <label className={styles.label} htmlFor="login-username">
              ユーザー名またはメールアドレス
            </label>
            <input
              id="login-username"
              className={styles.input}
              value={loginForm.username}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, username: event.target.value }))
              }
              required
            />

            <label className={styles.label} htmlFor="login-password">
              パスワード
            </label>
            <input
              id="login-password"
              className={styles.input}
              type="password"
              value={loginForm.password}
              onChange={(event) =>
                setLoginForm((current) => ({ ...current, password: event.target.value }))
              }
              required
            />

            <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
              ログイン
            </button>
          </form>
        ) : (
          <form className={styles.form} onSubmit={handleRegister}>
            <label className={styles.label} htmlFor="register-username">
              ユーザー名
            </label>
            <input
              id="register-username"
              className={styles.input}
              value={registerForm.username}
              onChange={(event) =>
                setRegisterForm((current) => ({ ...current, username: event.target.value }))
              }
              required
            />

            <label className={styles.label} htmlFor="register-email">
              メールアドレス
            </label>
            <input
              id="register-email"
              className={styles.input}
              type="email"
              value={registerForm.email}
              onChange={(event) =>
                setRegisterForm((current) => ({ ...current, email: event.target.value }))
              }
              required
            />

            <label className={styles.label} htmlFor="register-password">
              パスワード
            </label>
            <input
              id="register-password"
              className={styles.input}
              type="password"
              value={registerForm.password}
              onChange={(event) =>
                setRegisterForm((current) => ({ ...current, password: event.target.value }))
              }
              required
            />

            <button className={styles.submitButton} type="submit" disabled={isSubmitting}>
              登録
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
