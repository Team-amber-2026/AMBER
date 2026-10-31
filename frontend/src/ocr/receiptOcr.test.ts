import { describe, expect, it } from "vitest";

import {
  calculateReceiptImageSize,
  extractPurchasedAt,
  extractShopName,
  extractTotalAmount,
  extractTotalCandidate,
  resolveFieldCandidate,
  toClientOCRResult,
} from "./receiptOcr";

describe("receipt OCR field extraction", () => {
  it("prefers a candidate supported by multiple recognition passes", () => {
    expect(resolveFieldCandidate([
      { value: 1000, confidence: 80 },
      { value: 1200, confidence: 90 },
      { value: 1000, confidence: 75 },
    ])).toEqual({ value: 1000, confidence: 86 });
  });

  it("does not include field confidence in data sent for saving", () => {
    const result = {
      shop_name: "Market",
      purchased_at: "2026-06-12",
      total_amount: 1200,
      raw_ocr_text: "合計 1200",
      confidence: 90,
      field_confidence: { shop_name: 90, purchased_at: 85, total_amount: 92 },
      engine: "tesseract.js" as const,
    };

    expect(toClientOCRResult(result)).not.toHaveProperty("field_confidence");
  });

  it("removes OCR punctuation before the shop name", () => {
    expect(
      extractShopName([
        { text: "= FamilyMart", confidence: 91 },
        { text: "京都府京都市下京区五条通", confidence: 98 },
      ]),
    ).toBe("FamilyMart");
  });

  it("prefers a faint shop name in the receipt header over high-confidence footer text", () => {
    expect(
      extractShopName([
        { text: "ありがとうございました", confidence: 99, top: 0.88 },
        { text: "Amber Market", confidence: 61, top: 0.12 },
      ]),
    ).toBe("Amber Market");
  });

  it("uses the image position when OCR returns lines out of visual order", () => {
    expect(
      extractShopName([
        { text: "下部の案内文字", confidence: 99, top: 0.8 },
        { text: "アンバーマート", confidence: 72, top: 0.08 },
      ]),
    ).toBe("アンバーマート");
  });

  it.each([
    "毎度ありがとうございます",
    "単行本",
    "領 収 書",
    "領 収 証",
    "レ シ ー ト",
    "予めご了承ください",
    "ご了承くださいませ",
    "くださいませ",
  ])("does not select receipt boilerplate as the shop name: %s", (boilerplate) => {
    expect(
      extractShopName([
        { text: boilerplate, confidence: 99, top: 0.05 },
        { text: "マツモト", confidence: 62, top: 0.16 },
      ]),
    ).toBe("マツモト");
  });

  it("extracts a spaced Japanese receipt date", () => {
    expect(extractPurchasedAt("2026年 6月12日 (金) 9:10")).toBe("2026-06-12");
  });

  it("uses a repeated tax-inclusive amount when the total label is unreadable", () => {
    const text = [
      "= B01 ¥746",
      "8 % T H ¥746)",
      "内 消費 税 等 ¥55)",
      "51) ¥5,050",
      "koh ¥4,304",
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(746);
  });

  it("handles a misrecognized total label and the following tax-base line", () => {
    const text = [
      "含- 言二 ギ\\7スス",
      "( 8%対象 \\746)",
      "内消費税等 \\55)",
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(746);
  });

  it("does not mistake payment or change for the total", () => {
    const text = [
      "合 計 ¥746",
      "お預り ¥5,050",
      "お釣り ¥4,304",
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(746);
  });

  it("ignores a pre-discount subtotal when a final total is present", () => {
    const text = [
      "割引前商品合計 ¥2,500",
      "割引 ¥500",
      "合計 ¥2,000",
    ].join("\n");

    expect(extractTotalAmount(text)).toBe(2000);
  });

  it("keeps the same-line total confidence and ignores unrelated next-line payment data", () => {
    expect(
      extractTotalCandidate(
        "合計 ¥1200\nお預り ¥5,050\nお釣り ¥4,304",
        [
          { text: "合計 ¥1200", confidence: 98 },
          { text: "お預り ¥5,050", confidence: 90 },
          { text: "お釣り ¥4,304", confidence: 20 },
        ],
        95,
      ),
    ).toEqual({ value: 1200, confidence: 98 });
  });

  it("does not use cash tendered or change when the total label is missing", () => {
    expect(extractTotalAmount("現金 5000\nお釣り 4200")).toBeNull();
    expect(extractTotalAmount("現金 ¥5,000\nお釣り ¥4,200")).toBeNull();
  });

  it("extracts a same-line total without a currency symbol", () => {
    expect(extractTotalAmount("合計 1280")).toBe(1280);
  });

  it("extracts a following-line total without a currency symbol", () => {
    expect(extractTotalAmount("合計\n1280")).toBe(1280);
  });

  it("extracts a total below 100 yen", () => {
    expect(extractTotalAmount("合計 ¥80")).toBe(80);
  });

  it("does not use a receipt date as the total", () => {
    expect(extractTotalAmount("2026/07/25 合計 ¥746")).toBe(746);
  });

  it("does not use a time, percentage, or item count as the total", () => {
    expect(extractTotalAmount("合計 9:10 2点 8%対象 ¥746")).toBe(746);
  });

  it("prefers a currency amount over unrelated metadata after the keyword", () => {
    expect(extractTotalAmount("合計 注文No. 2026 ¥746")).toBe(746);
  });
});

describe("receipt OCR image sizing", () => {
  it("limits both the longest side and total pixel count", () => {
    const size = calculateReceiptImageSize(8000, 6000);

    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2200);
    expect(size.width * size.height).toBeLessThanOrEqual(4_000_000);
  });

  it("does not enlarge an image already within the limits", () => {
    expect(calculateReceiptImageSize(1200, 900)).toEqual({
      width: 1200,
      height: 900,
    });
  });
});
