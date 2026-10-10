import { Link } from "react-router-dom";

import styles from "./AccountPages.module.css";

type TopPageProps = { error: string };

export default function TopPage({ error }: TopPageProps) {
  return (
    <main className={styles.shell}>
      <header className={styles.brand}>ためるん</header>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className={styles.hero}>
        <p className={styles.eyebrow}>レシートから、かんたん家計簿</p>
        <h1>毎日の支出を、<br />さっと記録。</h1>
        <p>レシートを撮影するだけ。読み取った内容を確認して、今月のお金の使い方を振り返りましょう。</p>
        <nav className={styles.actions} aria-label="はじめる">
          <Link className={styles.primaryLink} to="/register">新規登録</Link>
          <Link className={styles.secondaryLink} to="/login">ログイン</Link>
        </nav>
      </section>
      <section className={styles.panel} aria-labelledby="how-to-title">
        <h2 id="how-to-title">3つのステップで支出を記録</h2>
        <ol className={styles.steps}>
          <li><strong>レシートを撮影・選択</strong><p>スマホで撮影した画像や、保存済みの画像を選びます。</p></li>
          <li><strong>内容を確認して保存</strong><p>店名・日付・金額・カテゴリーを確認。必要があれば修正できます。</p></li>
          <li><strong>今月の支出を振り返る</strong><p>支出一覧や月次集計で、お金の使い方を確認できます。</p></li>
        </ol>
      </section>
    </main>
  );
}
