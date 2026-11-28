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
    raw_ocr_text: "スーパー 合計100円", confidence: 90,
    field_confidence: { shop_name: 90, purchased_at: 90, total_amount: 90 },
    engine: "tesseract.js",
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderPage() {
  await act(async () => root.render(
    <MemoryRouter><ReceiptUploadPage /></MemoryRouter>,
  ));
}

async function selectFile(name = "receipt.png", label = "レシート画像") {
  const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  const bytes = new TextEncoder().encode("receipt");
  const file = Object.assign(new File([bytes], name, { type: "image/png" }), {
    // jsdom's File does not implement Blob.arrayBuffer().
    arrayBuffer: async () => bytes.buffer,
  });
  Object.defineProperty(input, "files", {
    configurable: true, value: [file],
  });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  return file;
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

describe("receipt source visibility", () => {
  it.each([
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  ])("keeps the original clickable area without source buttons on desktop: %s", async (userAgent) => {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 10 });
    vi.stubGlobal("innerWidth", 390);
    await renderPage();
    expect(container.textContent).not.toContain("カメラで撮影");
    expect(container.textContent).not.toContain("選択・撮影");
    expect(container.querySelector("input[capture]")).toBeNull();
    expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "画像を選択")).toBe(false);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const selectionArea = input.closest("label")!;
    expect(selectionArea.textContent).toContain("レシート画像を選択");
    expect(input.hidden).toBe(false);
    const openPicker = vi.fn();
    input.addEventListener("click", openPicker);
    await act(async () => selectionArea.click());
    expect(openPicker).toHaveBeenCalledOnce();
    const file = await selectFile();
    await clickButton("OCR解析へ進む");
    expect(vi.mocked(runReceiptOcr).mock.calls[0][0]).toBe(file);
  });
});

describe.each([
  ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"],
  ["Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/142.0.0.0 Mobile Safari/537.36"],
])("receipt image sources on %s", (_device, userAgent) => {
  beforeEach(() => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);
  });
  it.each([
    ["画像を選択", "レシート画像", null],
    ["カメラで撮影", "レシートをカメラで撮影", "environment"],
  ])("previews and analyzes the image from %s", async (button, label, capture) => {
    await renderPage();
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    const openPicker = vi.spyOn(input, "click").mockImplementation(() => {});
    await clickButton(button!);
    expect(openPicker).toHaveBeenCalledOnce();
    expect(input.getAttribute("capture")).toBe(capture);
    expect(input.accept).toBe("image/*");

    const file = await selectFile("receipt.png", label!);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:receipt");
    const [previewFile] = vi.mocked(URL.createObjectURL).mock.calls[0];
    if (capture) {
      expect(previewFile).not.toBe(file);
      expect(previewFile).toMatchObject({ name: file.name, type: file.type, size: file.size });
    } else {
      expect(previewFile).toBe(file);
    }
    await clickButton("OCR解析へ進む");
    expect(vi.mocked(runReceiptOcr).mock.calls[0][0]).toBe(previewFile);
    await clickButton("選択を解除");
    expect(container.querySelector("img")).toBeNull();
    await selectFile("receipt.png", label!);
    expect(container.querySelector("img")).not.toBeNull();
  });

  it("reads the temporary capture before resetting the camera input", async () => {
    await renderPage();
    const camera = container.querySelector<HTMLInputElement>('input[capture="environment"]')!;
    const resetInput = vi.spyOn(camera, "value", "set");
    const bytes = new TextEncoder().encode("receipt");
    let finishReading!: (value: ArrayBuffer) => void;
    const file = Object.assign(new File([bytes], "capture.png", { type: "image/png" }), {
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { finishReading = resolve; }),
    });
    Object.defineProperty(camera, "files", { configurable: true, value: [file] });
    await act(async () => camera.dispatchEvent(new Event("change", { bubbles: true })));
    expect(resetInput).not.toHaveBeenCalled();
    expect(container.textContent).toContain("撮影した画像を準備中…");

    await act(async () => finishReading(bytes.buffer));
    expect(resetInput).toHaveBeenCalledWith("");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:receipt");
    await clickButton("OCR解析へ進む");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:receipt");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("preserves the current receipt and OCR result when camera selection is cancelled", async () => {
    await failClassification();
    const camera = container.querySelector<HTMLInputElement>('input[capture="environment"]')!;
    Object.defineProperty(camera, "files", { configurable: true, value: [] });
    await act(async () => camera.dispatchEvent(new Event("change", { bubbles: true })));
    expect(container.textContent).toContain("receipt.png");
    expect(container.querySelector("img")).not.toBeNull();
    expect(container.querySelector("select")?.value).toBe("その他");
    expect(container.textContent).toContain(classificationWarning);
  });

  it("disables both sources while OCR is running", async () => {
    vi.mocked(runReceiptOcr).mockReturnValue(new Promise(() => {}));
    await renderPage();
    await selectFile();
    await clickButton("OCR解析へ進む");
    for (const label of ["画像を選択", "カメラで撮影"]) {
      const button = Array.from(container.querySelectorAll("button"))
        .find((element) => element.textContent === label)!;
      expect(button.disabled).toBe(true);
    }
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
      expect(input.disabled).toBe(true);
    }
  });
});

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

describe("OCR crop changes", () => {
  it("keeps a swipe native and only commits a completed long-press drag", async () => {
    await renderPage();
    await selectFile();
    const frame = container.querySelector("img")!.parentElement!;
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 100));
    function touch(type: string, x: number, y: number) {
      const point = { identifier: 1, clientX: x, clientY: y };
      const ended = type === "touchend" || type === "touchcancel";
      const event = new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: ended ? [] : [point as Touch],
        changedTouches: [point as Touch],
      });
      act(() => { frame.dispatchEvent(event); });
      return event;
    }

    vi.useFakeTimers();
    try {
      touch("touchstart", 10, 10);
      expect(touch("touchmove", 10, 30).defaultPrevented).toBe(false);
      act(() => vi.advanceTimersByTime(600));
      expect(touch("touchmove", 10, 60).defaultPrevented).toBe(false);
      touch("touchend", 10, 60);

      touch("touchstart", 20, 20);
      act(() => vi.advanceTimersByTime(500));
      expect(touch("touchmove", 70, 70).defaultPrevented).toBe(true);
      touch("touchend", 70, 70);

      touch("touchstart", 5, 5);
      act(() => vi.advanceTimersByTime(500));
      touch("touchmove", 90, 90);
      touch("touchcancel", 90, 90);
    } finally {
      vi.useRealTimers();
    }

    await clickButton("OCR解析へ進む");
    const selected = vi.mocked(runReceiptOcr).mock.calls[0][3];
    expect(selected?.x).toBe(0.2);
    expect(selected?.y).toBe(0.2);
    expect(selected?.width).toBeCloseTo(0.5);
    expect(selected?.height).toBeCloseTo(0.5);
  });

  it("invalidates analyzed data when the crop changes or is reset", async () => {
    await renderPage();
    await selectFile();
    await clickButton("OCR解析へ進む");
    expect(container.querySelector('[aria-labelledby="receipt-result-title"]')).not.toBeNull();

    const cropFrame = container.querySelector("img")!.parentElement!;
    vi.spyOn(cropFrame, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100,
      width: 100, height: 100, toJSON: () => ({}),
    } as DOMRect);
    await act(async () => {
      cropFrame.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true, clientX: 10, clientY: 10,
      }));
      cropFrame.dispatchEvent(new MouseEvent("pointermove", {
        bubbles: true, clientX: 80, clientY: 80,
      }));
      cropFrame.dispatchEvent(new MouseEvent("pointerup", {
        bubbles: true, clientX: 80, clientY: 80,
      }));
    });

    expect(container.querySelector('[aria-labelledby="receipt-result-title"]')).toBeNull();
    await clickButton("OCR解析へ進む");
    expect(container.querySelector('[aria-labelledby="receipt-result-title"]')).not.toBeNull();
    await clickButton("全体を選択");
    expect(container.querySelector('[aria-labelledby="receipt-result-title"]')).toBeNull();
  });
});
