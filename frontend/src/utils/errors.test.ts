import { describe, expect, it } from "vitest";

import { readableError } from "./errors";

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
      "サーバーでエラーが発生しました（500）。時間をおいて再度お試しください。",
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
