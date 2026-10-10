import axios, { type AxiosError } from "axios";

type ErrorResponse = {
  detail?: string;
  [key: string]: unknown;
};

export function readableError(error: unknown) {
  if (axios.isAxiosError(error) && error.code === "ERR_BAD_RESPONSE" && !error.response) {
    return "サーバーから正しいデータを取得できませんでした。時間をおいて再度お試しください。";
  }
  if (!isAxiosErrorResponse(error)) {
    return "通信に失敗しました。通信環境を確認して、もう一度お試しください。";
  }

  const data = error.response?.data;
  if (typeof data === "string") {
    const message = data.trim();
    if (message.startsWith("<!DOCTYPE html") || message.startsWith("<html")) {
      const status = error.response?.status;
      return status
        ? `サーバーでエラーが発生しました（${status}）。時間をおいて再度お試しください。`
        : "サーバーでエラーが発生しました。時間をおいて再度お試しください。";
    }
    return message || "通信に失敗しました。通信環境を確認して、もう一度お試しください。";
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "通信に失敗しました。通信環境を確認して、もう一度お試しください。";
  }

  const errorResponse = data as ErrorResponse;
  if (typeof errorResponse.detail === "string") {
    return errorResponse.detail;
  }

  return Object.entries(errorResponse)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`)
    .join("\n");
}

export function readableErrorStatus(error: unknown) {
  if (!isAxiosErrorResponse(error)) {
    return undefined;
  }

  return error.response?.status;
}

function isAxiosErrorResponse(error: unknown): error is AxiosError<unknown> {
  return axios.isAxiosError(error);
}
