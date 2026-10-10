import { Link } from "react-router-dom";

import type { User } from "../types";
import styles from "./AccountPages.module.css";

type MyPageProps = {
  user: User;
  error: string;
  isSubmitting: boolean;
  onLogout: () => Promise<void>;
};

export default function MyPage({ user, error, isSubmitting, onLogout }: MyPageProps) {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.brand}>ためるん</p>
        <h1>マイページ</h1>
      </header>
      <section className={styles.panel} aria-labelledby="account-title">
        <h2 id="account-title">アカウント情報</h2>
        <dl className={styles.profile}>
          <div><dt>ユーザー名</dt><dd>{user.username}</dd></div>
          <div><dt>メールアドレス</dt><dd>{user.email || "未設定"}</dd></div>
        </dl>
      </section>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <nav className={styles.actions} aria-label="アカウントの操作">
        <Link className={styles.secondaryLink} to="/home">ホームへ戻る</Link>
        <button type="button" onClick={onLogout} disabled={isSubmitting}>
          {isSubmitting ? "ログアウト中..." : "ログアウト"}
        </button>
      </nav>
    </main>
  );
}
