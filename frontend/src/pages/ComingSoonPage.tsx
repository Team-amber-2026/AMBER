import { Link } from "react-router-dom";

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
    <main className="app-shell">
      <header className="home-header">
        <div>
          <p className="eyebrow">ためるん</p>
          <h1>{title}</h1>
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

      <section className="section-block placeholder-block">
        <h2>準備中</h2>
        <p>{description}</p>
        <Link className="button-link" to="/home">
          ホームへ戻る
        </Link>
      </section>
    </main>
  );
}
