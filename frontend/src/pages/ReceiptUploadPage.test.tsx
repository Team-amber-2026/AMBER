// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { classifyCategory, fetchCategories } from "../api/expenses";
import { runReceiptOcr } from "../ocr/receiptOcr";
import ReceiptUploadPage from "./ReceiptUploadPage";

vi.mock("../api/expenses", () => ({
  classifyCategory: vi.fn(), fetchCategories: vi.fn(), saveExpense: vi.fn(),
}));
vi.mock("../ocr/receiptOcr", () => ({ runReceiptOcr: vi.fn(), toClientOCRResult: vi.fn() }));

const classificationWarning = "自動分類に失敗したため「その他」を設定しました。手動で変更できます。";
const listWarning = "カテゴリー一覧を取得できませんでした。ページを再読み込みしてください。";
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => "blob:receipt");
    static revokeObjectURL = vi.fn();
  });
  vi.mocked(fetchCategories).mockResolvedValue([{ id: 1, name: "食費" }, { id: 4, name: "その他" }]);
  vi.mocked(runReceiptOcr).mockResolvedValue({
    shop_name: "スーパー", purchased_at: "2026-08-01", total_amount: 100,
    raw_ocr_text: "スーパー 合計100円", confidence: 90, engine: "tesseract.js",
  });
  vi.mocked(classifyCategory).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ id: 1, name: "食費" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderPage() {
  await act(async () => root.render(
    <MemoryRouter><ReceiptUploadPage /></MemoryRouter>,
  ));
}

async function selectFile(name = "receipt.png") {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true, value: [new File(["receipt"], name, { type: "image/png" })],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function clickButton(text: string) {
  const button = Array.from(container.querySelectorAll("button"))
    .find((element) => element.textContent === text)!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

async function failClassification() {
  await renderPage();
  await selectFile();
  await clickButton("OCR解析へ進む");
  expect(container.textContent).toContain(classificationWarning);
  expect(container.querySelector("select")?.value).toBe("その他");
}

describe("classification error recovery", () => {
  it("clears the warning when retry starts and displays the successful category", async () => {
    await failClassification();
    let completeClassification!: (value: { id: number; name: string }) => void;
    vi.mocked(classifyCategory).mockReturnValueOnce(new Promise((resolve) => {
      completeClassification = resolve;
    }));
    await clickButton("OCR解析へ進む");
    expect(container.textContent).not.toContain(classificationWarning);
    await act(async () => completeClassification({ id: 1, name: "食費" }));
    expect(container.textContent).not.toContain(classificationWarning);
    expect(container.querySelector("select")?.value).toBe("食費");
  });

  it("clears the warning when another receipt is selected", async () => {
    await failClassification();
    await selectFile("second.png");
    expect(container.textContent).not.toContain(classificationWarning);
    await clickButton("OCR解析へ進む");
    expect(container.querySelector("select")?.value).toBe("食費");
    expect(container.textContent).not.toContain(classificationWarning);
  });

  it("clears the warning when the selection is removed", async () => {
    await failClassification();
    await clickButton("選択を解除");
    expect(container.textContent).not.toContain(classificationWarning);
    expect(container.querySelector("select")).toBeNull();
  });

  it("keeps category-list failures visible after reset and successful classification", async () => {
    vi.mocked(fetchCategories).mockRejectedValueOnce(new Error("offline"));
    await failClassification();
    expect(container.textContent).toContain(listWarning);
    await selectFile("second.png");
    await clickButton("OCR解析へ進む");
    expect(container.textContent).not.toContain(classificationWarning);
    expect(container.textContent).toContain(listWarning);
    expect(container.querySelector("select")?.value).toBe("食費");
  });
});
