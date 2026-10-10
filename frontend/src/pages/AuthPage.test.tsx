import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import AuthPage from "./AuthPage";
import type { AuthMode } from "../types";

function renderAuth(mode: AuthMode, error = "") {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuthPage
        mode={mode}
        user={null}
        loginForm={{ username: "", password: "" }}
        registerForm={{ username: "", email: "", password: "" }}
        message=""
        error={error}
        isSubmitting={false}
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        setLoginForm={vi.fn()}
        setRegisterForm={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe("registration password guidance", () => {
  it("shows the effective rules before typing and associates them with the password input", () => {
    const html = renderAuth("register");
    expect(html).toContain("8文字以上で入力してください。");
    expect(html).toContain("よく使われるパスワードは使用できません。");
    expect(html).toContain("数字だけのパスワードは使用できません。");
    expect(html).toContain('aria-describedby="register-password-help"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).not.toContain('aria-invalid="true"');
  });

  it("shows password and other errors once above the form", () => {
    const messages = [
      "このパスワードは短すぎます。最低 8 文字以上必要です。",
      "このパスワードは一般的すぎます。",
      "このユーザー名は既に使用されています。",
      "このメールアドレスは既に使用されています。",
      "通信に失敗しました。",
    ];
    const html = renderAuth("register", messages.join("\n"));
    expect(html).toContain('id="auth-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-describedby="register-password-help"');
    expect(html).not.toContain('id="register-password-error"');
    for (const message of messages) {
      expect(html.split(message)).toHaveLength(2);
      expect(html.indexOf(message)).toBeLessThan(html.indexOf("<form"));
    }
  });

  it("does not apply new registration rules or errors to login", () => {
    const message = "ユーザー名またはパスワードが正しくありません。";
    const html = renderAuth("login", message);
    expect(html).toContain('id="login-password"');
    expect(html).not.toContain("register-password-help");
    expect(html.split(message)).toHaveLength(2);
    expect(html.indexOf(message)).toBeLessThan(html.indexOf("<form"));
  });
});
