import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import AuthPage from "./AuthPage";
import type { AuthMode } from "../types";

function renderAuth(mode: AuthMode, registerPasswordError = "") {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AuthPage
        mode={mode}
        user={null}
        loginForm={{ username: "", password: "" }}
        registerForm={{ username: "", email: "", password: "" }}
        message=""
        error=""
        registerPasswordError={registerPasswordError}
        isSubmitting={false}
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onRegisterPasswordChange={vi.fn()}
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

  it("places server errors after the password help and links them for assistive technology", () => {
    const html = renderAuth("register", "このパスワードは一般的すぎます。");
    expect(html).toContain('aria-describedby="register-password-help register-password-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert">このパスワードは一般的すぎます。</p>');
    expect(html.indexOf('id="register-password-error"')).toBeGreaterThan(html.indexOf('id="register-password-help"'));
  });

  it("does not apply new registration rules or errors to login", () => {
    const html = renderAuth("login", "このパスワードは一般的すぎます。");
    expect(html).toContain('id="login-password"');
    expect(html).not.toContain("register-password-help");
    expect(html).not.toContain("このパスワードは一般的すぎます。");
  });
});
