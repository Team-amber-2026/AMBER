import { describe, expect, it } from "vitest";

import { readableError, readableFieldError } from "./errors";

describe("readableError", () => {
  it("explains an invalid JSON response without treating it as a successful request", () => {
    expect(readableError({ isAxiosError: true, code: "ERR_BAD_RESPONSE" })).toBe(
      "サーバーから正しいデータを取得できませんでした。時間をおいて再度お試しください。",
    );
  });

  it("does not render an HTML error page one character per line", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 500,
        data: "<!DOCTYPE html><html><title>OperationalError</title></html>",
      },
    };

    expect(readableError(error)).toBe(
      "サーバーでエラーが発生しました（500）。バックエンドのログを確認してください。",
    );
  });

  it("formats JSON validation errors", () => {
    const error = {
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          purchased_at: ["購入日を入力してください。"],
        },
      },
    };

    expect(readableError(error)).toBe("purchased_at: 購入日を入力してください。");
  });
});

describe("readableFieldError", () => {
  it("keeps all password messages separate from other registration errors", () => {
    expect(readableFieldError({
      isAxiosError: true,
      response: { data: {
        username: ["このユーザー名は既に使用されています。"],
        password: ["8文字以上で入力してください。", "数字だけのパスワードは使用できません。"],
      } },
    }, "password")).toBe("8文字以上で入力してください。\n数字だけのパスワードは使用できません。");
  });

  it("leaves network, HTML and unrelated field errors to the general error display", () => {
    for (const error of [
      new Error("Network error"),
      { isAxiosError: true },
      { isAxiosError: true, response: { data: "<html>Error</html>" } },
      { isAxiosError: true, response: { data: { email: ["メールアドレスを入力してください。"] } } },
    ]) {
      expect(readableFieldError(error, "password")).toBe("");
    }
  });
});
