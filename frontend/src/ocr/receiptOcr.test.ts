import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateReceiptImageSize,
  choosePreferredShopNameCandidate,
  extractPurchasedAt,
  extractShopName,
  extractShopNameCandidate,
  extractTotalAmount,
  extractTotalCandidate,
  mergeReceiptOcrText,
  resolveFieldCandidate,
  runReceiptOcr,
  shouldReanalyzeReceiptBody,
  toClientOCRResult,
} from "./receiptOcr";

const { recognize } = vi.hoisted(() => ({ recognize: vi.fn() }));

vi.mock("tesseract.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("tesseract.js")>(),
  createWorker: vi.fn(async () => ({ recognize, setParameters: vi.fn(async () => undefined) })),
}));

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

  it("prefers the first header line when the shop and product use the same font size", () => {
    expect(
      extractShopName([
        { text: "アンバーマート", confidence: 62, top: 0.06, height: 22 },
        { text: "牛乳", confidence: 96, top: 0.16, height: 22 },
        { text: "合計 198", confidence: 99, top: 0.82, height: 22 },
      ]),
    ).toBe("アンバーマート");
  });

  it("prefers a readable branch line over a short logo-like Latin token", () => {
    expect(
      extractShopName([
        { text: "Que", confidence: 91, top: 0.05, height: 40 },
        { text: "西小路店", confidence: 86, top: 0.15, height: 24 },
      ]),
    ).toBe("西小路店");
  });

  it("combines a readable Latin brand with its branch name", () => {
    expect(
      extractShopName([
        { text: "FamilyMart", confidence: 92, top: 0.04, height: 42 },
        { text: "五条大宮店", confidence: 88, top: 0.13, height: 24 },
      ]),
    ).toBe("FamilyMart 五条大宮店");
  });

  it("prefers the raw OCR shop name when a plausible full-text candidate exists", () => {
    const rawText = [
      { text: "アイリス商店", confidence: 92, top: 0.22 },
      { text: "ありがとうございました", confidence: 98, top: 0.88 },
    ];
    const headerText = [
      { text: "Thank you for shopping", confidence: 96, top: 0.18 },
      { text: "アイリス商店", confidence: 64, top: 0.12 },
    ];

    expect(
      choosePreferredShopNameCandidate(
        [extractShopNameCandidate(rawText)],
        extractShopNameCandidate(headerText),
      ),
    ).toEqual({ value: "アイリス商店", confidence: 92 });
  });

  it("uses a header-only candidate when the full-page candidate is weak", () => {
    expect(
      choosePreferredShopNameCandidate(
        [{ value: "牛乳", confidence: 86 }],
        { value: "アンバーマート", confidence: 70 },
      ),
    ).toEqual({ value: "アンバーマート", confidence: 70 });
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

  it("normalizes a two-digit year and hyphen-separated receipt date", () => {
    expect(extractPurchasedAt("26-07-25")).toBe("2026-07-25");
  });

  it("does not extract a date from the middle of a telephone number", () => {
    expect(extractPurchasedAt("TEL 0120-12-1234")).toBeNull();
    expect(extractPurchasedAt("TEL 0120-12-1234\n26-07-25")).toBe("2026-07-25");
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

  it("prefers the total amount even when a subtotal is written on the same line", () => {
    expect(extractTotalAmount("小計 ¥1,000 合計 ¥1,200")).toBe(1200);
  });

  it("does not let a later item amount override the same-line total", () => {
    expect(extractTotalAmount("合計 ¥1200\n商品A ¥500")).toBe(1200);
  });

  it("ignores non-currency aggregate totals such as points before a valid final total", () => {
    expect(extractTotalAmount("合計 ¥1200\n今回獲得ポイント合計 12")).toBe(1200);
  });

  it("ignores aggregate point totals that appear just after the total keyword", () => {
    expect(extractTotalAmount("合計 ¥1200\n合計ポイント 12")).toBe(1200);
  });

  it("keeps the real total when a point summary is appended after the amount", () => {
    expect(extractTotalAmount("合計 ¥1200（ポイント利用 100）")).toBe(1200);
  });

  it("keeps the real total when a point summary is stated before the amount on the same line", () => {
    expect(extractTotalAmount("合計（ポイント利用 100）¥1,200")).toBe(1200);
    expect(extractTotalAmount("合計（ポイント利用 100）1,200円")).toBe(1200);
    expect(extractTotalAmount("合計 ポイント利用 100 ¥1,200")).toBe(1200);
  });

  it("does not treat a point-aggregate label as a total when it is directly attached to the keyword", () => {
    expect(extractTotalAmount("合計ポイント ¥100")).toBeNull();
  });

  it("allows a trailing marker on a following-line total", () => {
    expect(extractTotalAmount("合計\n¥1,200※")).toBe(1200);
  });

  it("does not treat a product line as the total when only the total label is on the previous line", () => {
    expect(extractTotalAmount("合計\n商品A ¥50")).toBeNull();
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
    ).toEqual({ value: 1200, confidence: 98, evidence: "labeledTotal" });
  });

  it("accepts a following-line total with a trailing amount marker", () => {
    expect(
      extractTotalCandidate(
        "合計\n¥1,200※",
        [
          { text: "合計", confidence: 95 },
          { text: "¥1,200※", confidence: 90 },
        ],
        95,
      ),
    ).toEqual({ value: 1200, confidence: 90, evidence: "labeledTotal" });
  });

  it("keeps labeled evidence when only the raw text contains the total label", () => {
    expect(extractTotalCandidate("合計 ¥755", [{ text: "¥755", confidence: 90 }], 82))
      .toEqual({ value: 755, confidence: 82, evidence: "labeledTotal" });
  });

  it("marks a repeated product price as inferred evidence", () => {
    const lines = [
      { text: "牛乳 ¥198", confidence: 80 },
      { text: "チーズ ¥198", confidence: 80 },
    ];
    const text = lines.map((line) => line.text).join("\n");
    expect(extractTotalCandidate(text, lines, 80))
      .toEqual({ value: 198, confidence: 60, evidence: "inferredTotal" });
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

  it("does not treat product or discount subtotals as the final total", () => {
    expect(
      extractTotalAmount([
        "商品合計 ¥805",
        "値引合計 -50",
        "合計 ¥755",
        "お預り ¥1,055",
        "お釣り ¥300",
      ].join("\n")),
    ).toBe(755);
  });

  it("re-runs the body pass when metadata exists but product rows are missing", () => {
    const lines = Array.from({ length: 10 }, (_, index) => ({
      text: index < 3 ? `¥${index + 1}00` : "登録番号 metadata",
      confidence: 90,
      top: 0.2 + index * 0.03,
    }));
    expect(shouldReanalyzeReceiptBody([lines])).toBe(true);
  });

  it("does not re-run the body pass when product rows are present", () => {
    const lines = [
      { text: "テリヤキチキンとたまご ¥348", confidence: 90, top: 0.3 },
      { text: "野菜生活マンゴーサラダ ¥135", confidence: 90, top: 0.35 },
      { text: "3種のミックスサンド ¥322", confidence: 90, top: 0.4 },
      ...Array.from({ length: 7 }, () => ({
        text: "案内文",
        confidence: 90,
        top: 0.5,
      })),
    ];
    expect(shouldReanalyzeReceiptBody([lines])).toBe(false);
  });

  it("merges only missing focused product rows without duplicating existing lines", () => {
    expect(mergeReceiptOcrText(
      "テリヤキチキンとたまご ¥348\n合計 ¥755",
      ["テリヤキチキンとたまご ¥348", "野菜生活マンゴーサラダ ¥135"],
    )).toBe("テリヤキチキンとたまご ¥348\n合計 ¥755\n野菜生活マンゴーサラダ ¥135");
  });

  it.each([
    ["牛乳 ¥198", "豆乳 ¥198"],
    ["牛乳500ml ¥198", "牛乳1000ml ¥198"],
    ["牛乳 1個 ¥198", "牛乳 2個 ¥198"],
    ["牛乳 ¥198 1個", "牛乳 ¥198 2個"],
    ["牛乳 198", "牛乳 1,980"],
  ])("keeps separate product rows: %s and %s", (base, supplemental) => {
    expect(mergeReceiptOcrText(base, [supplemental])).toBe(`${base}\n${supplemental}`);
  });

  it("deduplicates the same product across inline and split price formats", () => {
    expect(mergeReceiptOcrText("牛乳５００ｍｌ\n￥１，９８０", ["牛 乳500ml 1980"]))
      .toBe("牛乳５００ｍｌ\n￥１，９８０");
  });

  it("does not append totals, receipt metadata, or unpaired amounts as products", () => {
    expect(mergeReceiptOcrText("牛乳 ¥198", [
      "¥100", "合計", "¥1,200", "登録番号 T1234567890123", "250", "お預り 2000",
    ])).toBe("牛乳 ¥198");
  });
});

describe("receipt OCR recognition passes", () => {
  afterEach(() => {
    recognize.mockReset();
    vi.unstubAllGlobals();
  });

  function mockReceiptImage() {
    vi.stubGlobal("createImageBitmap", async () => ({ width: 200, height: 400, close: vi.fn() }));
    vi.stubGlobal("document", {
      createElement: () => {
        const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
        return {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: vi.fn(),
            getImageData: () => ({ data }),
            putImageData: vi.fn(),
          }),
        };
      },
    });
    return new File([], "receipt.png", { type: "image/png" });
  }

  it("supplements product rows and prefers the labeled total from the focused pass", async () => {
    const image = mockReceiptImage();
    const text = "TEL 0120-12-1234\n牛乳 ¥198\nチーズ ¥198\n26-07-25";
    const pixels: number[][] = [];
    const fullPagePass = async (canvas: HTMLCanvasElement) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, 2, 1).data;
      pixels.push([data[0], data[4]]);
      return { data: { text, confidence: 80 } };
    };
    // Supply the focused results after the full-page and header passes.
    for (let pass = 0; pass < 5; pass += 1) {
      recognize.mockImplementationOnce(fullPagePass);
    }
    recognize
      .mockResolvedValueOnce({
        data: { text: "豆乳 ¥198\n食パン 159\n果汁\n¥200\n米菓\n110", confidence: 100 },
      })
      .mockResolvedValueOnce({ data: { text: "合計 ¥755", confidence: 100 } });

    const result = await runReceiptOcr(image);

    expect(result.purchased_at).toBe("2026-07-25");
    expect(pixels[2]).toEqual([0, 255]);
    expect(pixels[4]).toEqual([255, 0]);
    expect(result).toMatchObject({
      raw_ocr_text: `${text}\n豆乳 ¥198\n食パン 159\n果汁\n¥200\n米菓\n110`,
      total_amount: 755,
    });
  });

  it("runs the focused total pass when all high-confidence totals are inferred", async () => {
    const image = mockReceiptImage();
    recognize.mockResolvedValue({ data: { text: "合計\n¥755", confidence: 100 } });
    for (let pass = 0; pass < 6; pass += 1) {
      recognize.mockResolvedValueOnce({ data: { text: "牛乳 ¥198\nチーズ ¥198", confidence: 100 } });
    }

    const result = await runReceiptOcr(image);

    expect(recognize).toHaveBeenCalledTimes(7);
    expect(result.total_amount).toBe(755);
  });
});

describe("receipt OCR image sizing", () => {
  it("limits both the longest side and total pixel count", () => {
    const size = calculateReceiptImageSize(8000, 6000);

    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(3200);
    expect(size.width * size.height).toBeLessThanOrEqual(6_000_000);
  });

  it("does not enlarge an image already within the limits", () => {
    expect(calculateReceiptImageSize(1200, 900)).toEqual({
      width: 1200,
      height: 900,
    });
  });
});
