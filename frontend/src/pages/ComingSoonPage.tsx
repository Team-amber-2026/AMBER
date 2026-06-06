import { Link } from "react-router-dom";
import styles from "./ComingSoonPage.module.css";

type ComingSoonPageProps = {
  title: string;
  description: string;
  isSubmitting: boolean;
  onLogout: () => Promise<void>;
};

export default function ComingSoonPage({
  title,
  description,
  isSubmitting,
  onLogout,
}: ComingSoonPageProps) {
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ためるん</p>
          <h1>{title}</h1>
        </div>
        <button
          type="button"
          className={`${styles.buttonSecondary} ${styles.buttonCompact}`}
          onClick={onLogout}
          disabled={isSubmitting}
        >
          ログアウト
        </button>
      </header>

      <section className={styles.sectionBlock}>
        <h2>準備中</h2>
        <p>{description}</p>
        <Link className={styles.buttonLink} to="/home">
          ホームへ戻る
        </Link>
      </section>
    </main>
  );
}
