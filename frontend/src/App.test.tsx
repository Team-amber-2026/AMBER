// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import * as auth from "./api/auth";
import * as expenses from "./api/expenses";
import { runReceiptOcr } from "./ocr/receiptOcr";
import type { ReceiptOCRResult, SavedExpense } from "./types";

vi.mock("./api/auth");
vi.mock("./api/expenses");
vi.mock("./ocr/receiptOcr", () => ({
  runReceiptOcr: vi.fn(),
  toClientOCRResult: (result: ReceiptOCRResult) => result,
}));

// jsdom omits blob URLs and native dialog methods. Browser QA covers the real dialog.
URL.createObjectURL ??= () => "blob:receipt";
URL.revokeObjectURL ??= () => {};
HTMLDialogElement.prototype.showModal = function () { this.open = true; };
HTMLDialogElement.prototype.close = function () { this.open = false; };

const user = { id: 1, username: "テストユーザー", email: "test@example.com" };
const today = new Date();
const expense: SavedExpense = {
  id: 1, user: 1, shop_name: "テスト商店", total_amount: 1200,
  purchased_at: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`,
  category: "食費", raw_ocr_text: "合計 1200円", created_at: "", updated_at: "",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function HistoryControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <aside aria-label="テスト用履歴操作">
      <output data-testid="path">{location.pathname}</output>
      <button onClick={() => navigate(-1)}>履歴を戻る</button>
      <button onClick={() => navigate(1)}>履歴を進む</button>
    </aside>
  );
}

function renderApp(path = "/", state?: unknown, previousPath?: string) {
  const entry = { pathname: path, state };
  return render(
    <MemoryRouter initialEntries={previousPath ? [previousPath, entry] : [entry]}>
      <App />
      <HistoryControls />
    </MemoryRouter>,
  );
}

async function expectPath(path: string) {
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe(path));
}

function unauthenticated() {
  vi.mocked(auth.fetchCurrentUser).mockRejectedValue({ isAxiosError: true, response: { status: 403 } });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(auth.fetchCurrentUser).mockResolvedValue(user);
  vi.mocked(auth.loginUser).mockResolvedValue(user);
  vi.mocked(auth.registerUser).mockResolvedValue(user);
  vi.mocked(auth.logoutUser).mockResolvedValue(undefined);
  vi.mocked(expenses.fetchExpenses).mockResolvedValue([expense]);
  vi.mocked(expenses.fetchExpenseDetail).mockResolvedValue(expense);
  vi.mocked(expenses.fetchMonthlySummary).mockResolvedValue({
    year: today.getFullYear(), month: today.getMonth() + 1,
    grand_total: 1200, categories: [{ category: "食費", total: 1200 }],
  });
  vi.mocked(expenses.saveExpense).mockResolvedValue(expense);
  vi.mocked(expenses.updateExpense).mockResolvedValue(expense);
  vi.mocked(expenses.deleteExpense).mockResolvedValue(undefined);
  vi.mocked(runReceiptOcr).mockResolvedValue({
    shop_name: expense.shop_name, purchased_at: expense.purchased_at, total_amount: 1200,
    raw_ocr_text: expense.raw_ocr_text, confidence: 95, engine: "tesseract.js",
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:receipt");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.open = false; });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("public and account navigation", () => {
  it("shows the top page and links to registration, login and back", async () => {
    unauthenticated();
    renderApp();
    await screen.findByRole("heading", { name: /毎日の支出を/ });
    const session = userEvent.setup();
    await session.click(screen.getByRole("link", { name: "新規登録" }));
    await expectPath("/register");
    await session.click(screen.getByRole("link", { name: "トップへ戻る" }));
    await session.click(screen.getByRole("link", { name: "ログイン" }));
    await expectPath("/login");
  });

  it.each(["/", "/login", "/register"])("redirects signed-in users from %s to home", async (path) => {
    renderApp(path);
    await screen.findByRole("heading", { name: "テストユーザーさんのホーム" });
    await expectPath("/home");
  });

  it("requires login for My Page", async () => {
    unauthenticated();
    renderApp("/mypage");
    await screen.findByLabelText("ユーザー名またはメールアドレス");
    await expectPath("/login");
    expect(screen.queryByText(user.email)).toBeNull();
  });

  it("keeps registration followed by login, then home", async () => {
    unauthenticated();
    renderApp("/register");
    const session = userEvent.setup();
    await session.type(await screen.findByLabelText("ユーザー名"), "new-user");
    await session.type(screen.getByLabelText("メールアドレス"), "new@example.com");
    await session.type(screen.getByLabelText("パスワード"), "ExamplePassword123!");
    await session.click(screen.getByRole("button", { name: "登録" }));
    await expectPath("/login");
    expect(auth.loginUser).not.toHaveBeenCalled();
    expect(screen.getByText("登録が完了しました。ログインしてください。")).toBeTruthy();
    await session.type(screen.getByLabelText("ユーザー名またはメールアドレス"), "new-user");
    await session.type(screen.getByLabelText("パスワード"), "ExamplePassword123!");
    await session.click(screen.getByRole("button", { name: "ログイン" }));
    await expectPath("/home");
  });

  it.each([
    ["レシートを登録", "/receipts/new", "button"],
    ["支出一覧", "/expenses", "button"],
    ["月次集計", "/summary", "button"],
    ["マイページ", "/mypage", "link"],
  ])("opens %s from home", async (name, path, role) => {
    renderApp("/home");
    await userEvent.click(await screen.findByRole(role, { name }));
    await expectPath(path);
  });

  it("shows account details and submits logout only once, then protects history", async () => {
    const request = deferred<void>();
    vi.mocked(auth.logoutUser).mockReturnValue(request.promise);
    renderApp("/mypage", undefined, "/home");
    expect(await screen.findByText(user.email)).toBeTruthy();
    expect(screen.getByText(user.username)).toBeTruthy();
    const button = screen.getByRole("button", { name: "ログアウト" });
    // Two events in one render cycle exercise the synchronous guard as well as disabled UI.
    act(() => { button.click(); button.click(); });
    expect(auth.logoutUser).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "ログアウト中..." }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => request.resolve());
    await expectPath("/login");
    expect(screen.getByText("ログアウトしました。")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "履歴を戻る" }));
    await expectPath("/login");
    expect(screen.queryByText(user.email)).toBeNull();
  });

  it("shows logout failure in My Page, keeps the session, and permits retry", async () => {
    vi.mocked(auth.logoutUser).mockRejectedValueOnce(new Error("network"));
    renderApp("/mypage");
    await userEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
    expect((await screen.findByRole("alert")).textContent).toContain("通信環境を確認");
    await expectPath("/mypage");
    expect(screen.getByText(user.email)).toBeTruthy();
    await userEvent.click(screen.getByRole("link", { name: "ホームへ戻る" }));
    await screen.findByRole("heading", { name: "テストユーザーさんのホーム" });
    await userEvent.click(screen.getByRole("link", { name: "マイページ" }));
    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    await expectPath("/login");
    expect(auth.logoutUser).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["/home", "テストユーザーさんのホーム"],
    ["/expenses", "保存済みの支出"],
    ["/summary", `${today.getFullYear()}年 ${today.getMonth() + 1}月`],
    ["/expenses/1", "テスト商店"],
    ["/expenses/1/edit", "テスト商店"],
    ["/receipts/new", "画像を選択して読み取り"],
    ["/receipts/complete", "支出を保存しました"],
  ])("has no logout control on %s", async (path, heading) => {
    renderApp(path, { expense });
    await screen.findByRole("heading", { name: heading, level: 1 });
    expect(screen.queryByRole("button", { name: /ログアウト/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /ログアウト/ })).toBeNull();
  });
});

describe("saving and expense navigation", () => {
  async function prepareReceipt() {
    const input = await screen.findByLabelText("レシート画像");
    await userEvent.upload(input, new File(["receipt"], "receipt.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: "OCR解析へ進む" }));
    return await screen.findByRole("button", { name: "支出として保存" });
  }

  it("saves once on repeated clicks and replaces the form history", async () => {
    const request = deferred<SavedExpense>();
    vi.mocked(expenses.saveExpense).mockReturnValue(request.promise);
    renderApp("/receipts/new", undefined, "/home");
    const button = await prepareReceipt();
    act(() => { button.click(); button.click(); });
    expect(expenses.saveExpense).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "保存中..." }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => request.resolve(expense));
    await screen.findByRole("heading", { name: "支出を保存しました" });
    await userEvent.click(screen.getByRole("button", { name: "履歴を戻る" }));
    await expectPath("/home");
    await userEvent.click(screen.getByRole("button", { name: "履歴を進む" }));
    await expectPath("/receipts/complete");
    expect(expenses.saveExpense).toHaveBeenCalledTimes(1);
  });

  it("retains receipt input after a save error and permits retry", async () => {
    vi.mocked(expenses.saveExpense).mockRejectedValueOnce(new Error("network"));
    renderApp("/receipts/new");
    await userEvent.click(await prepareReceipt());
    await screen.findByText(/通信に失敗しました/);
    expect((screen.getByLabelText("店名") as HTMLInputElement).value).toBe(expense.shop_name);
    await userEvent.click(screen.getByRole("button", { name: "支出として保存" }));
    await expectPath("/receipts/complete");
    expect(expenses.saveExpense).toHaveBeenCalledTimes(2);
  });

  it("starts a blank receipt after completion", async () => {
    renderApp("/receipts/new");
    await userEvent.click(await prepareReceipt());
    await userEvent.click(await screen.findByRole("button", { name: "続けて登録" }));
    await expectPath("/receipts/new");
    expect((screen.getByLabelText("レシート画像") as HTMLInputElement).files?.length).toBe(0);
    expect(screen.queryByLabelText("店名")).toBeNull();
    expect(screen.queryByRole("button", { name: "支出として保存" })).toBeNull();
    expect(expenses.saveExpense).toHaveBeenCalledTimes(1);
  });

  it("renders preserved completion state again without saving and can return home", async () => {
    const first = renderApp("/receipts/complete", { expense });
    await screen.findByRole("heading", { name: "支出を保存しました" });
    first.unmount();
    renderApp("/receipts/complete", { expense });
    await screen.findByRole("heading", { name: "支出を保存しました" });
    expect(expenses.saveExpense).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "ホームへ戻る" }));
    await expectPath("/home");
  });

  it("redirects completion without saved data to a new receipt", async () => {
    renderApp("/receipts/complete");
    await screen.findByRole("heading", { name: "画像を選択して読み取り" });
    await expectPath("/receipts/new");
    expect(expenses.saveExpense).not.toHaveBeenCalled();
  });

  it("navigates list → detail → edit → detail → delete → list", async () => {
    renderApp("/expenses");
    await userEvent.click(await screen.findByRole("button", { name: /テスト商店/ }));
    await expectPath("/expenses/1");
    await userEvent.click(await screen.findByRole("button", { name: "編集" }));
    await expectPath("/expenses/1/edit");
    const shop = await screen.findByLabelText("店名");
    fireEvent.change(shop, { target: { value: "変更後の店名" } });
    vi.mocked(expenses.updateExpense).mockResolvedValueOnce({ ...expense, shop_name: "変更後の店名" });
    vi.mocked(expenses.fetchExpenseDetail).mockResolvedValue({ ...expense, shop_name: "変更後の店名" });
    await userEvent.click(screen.getByRole("button", { name: "変更を保存" }));
    await expectPath("/expenses/1");
    await screen.findByRole("heading", { name: "変更後の店名" });
    expect(expenses.updateExpense).toHaveBeenCalledWith(1, expect.objectContaining({ shop_name: "変更後の店名" }));
    await userEvent.click(screen.getByRole("button", { name: "削除" }));
    vi.mocked(expenses.fetchExpenses).mockResolvedValue([]);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "削除する" }));
    await expectPath("/expenses");
    await screen.findByText("まだ支出がありません。");
    expect(expenses.deleteExpense).toHaveBeenCalledWith(1);
  });
});
