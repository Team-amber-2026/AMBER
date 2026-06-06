import apiClient from "./client";
import type { ReceiptAnalyzeResult } from "../types";

export async function analyzeReceiptImage(image: File) {
  const formData = new FormData();
  formData.append("image", image);

  const response = await apiClient.post<ReceiptAnalyzeResult>("/receipts/analyze/", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });

  return response.data;
}
