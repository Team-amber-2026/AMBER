// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it } from "vitest";

import App from "./App";
import apiClient from "./api/client";

const originalAdapter = apiClient.defaults.adapter;
const expiredMessage = "セッションが切れました。再度ログインしてください";
const expired = { isAxiosError: true, response: { status: 403, data: { code: "not_authenticated" } } };

afterEach(() => {
  cleanup();
  apiClient.defaults.adapter = originalAdapter;
});

function HistoryControls() {
  const navigate = useNavigate();
  return <>
    <output data-testid="path">{useLocation().pathname}</output>
    <button onClick={() => navigate(-1)}>戻る</button>
  </>;
}

async function openHome() {
  apiClient.defaults.adapter = async (config) => {
    const responses: Record<string, unknown> = {
      "/auth/user/": { id: 1, username: "alice" },
      "/summary/monthly/": { grand_total: 1200, categories: [] },
      "/expenses/": [],
    };
    return { config, data: responses[config.url!], status: 200, statusText: "OK", headers: {} };
  };
  render(<MemoryRouter initialEntries={["/home"]}><App /><HistoryControls /></MemoryRouter>);
  await screen.findByRole("heading", { name: /1,200/ });
}

it.each(["支出一覧", "月次集計", "レシートを登録"])("ends the session when %s reports missing authentication", async (name) => {
  await openHome();
  apiClient.defaults.adapter = async () => { throw expired; };
  await userEvent.click(screen.getByRole("button", { name }));
  await screen.findByText(expiredMessage);
  expect(screen.getByTestId("path").textContent).toBe("/login");
  await userEvent.click(screen.getByRole("button", { name: "戻る" }));
  await screen.findByLabelText("ユーザー名またはメールアドレス");
  expect(screen.getByTestId("path").textContent).toBe("/login");
});

it("keeps the session after a network failure while loading expenses", async () => {
  await openHome();
  apiClient.defaults.adapter = async () => { throw new Error("Network Error"); };
  await userEvent.click(screen.getByRole("button", { name: "支出一覧" }));
  await screen.findByText("支出一覧の読み込みに失敗しました。");
  expect(screen.getByTestId("path").textContent).toBe("/expenses");
  await userEvent.click(screen.getByRole("button", { name: "ホームへ戻る" }));
  await screen.findByRole("heading", { name: "aliceさんのホーム" });
});

it("shows a CSRF rejection on My Page and handles an expired session on retry", async () => {
  await openHome();
  await userEvent.click(screen.getByRole("link", { name: "マイページ" }));
  document.cookie = "csrftoken=test-token";
  try {
    const detail = "CSRF Failed: CSRF token incorrect.";
    apiClient.defaults.adapter = async () => {
      throw { isAxiosError: true, response: { status: 403, data: { detail } } };
    };
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await screen.findByText(detail);
    expect(screen.getByTestId("path").textContent).toBe("/mypage");

    apiClient.defaults.adapter = async () => { throw expired; };
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await screen.findByText(expiredMessage);
    expect(screen.getByTestId("path").textContent).toBe("/login");
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    document.cookie = "csrftoken=; Max-Age=0";
  }
});
