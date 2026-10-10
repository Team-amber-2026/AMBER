import apiClient from "./client";
import type { ExpenseSavePayload, MonthlySummaryResponse, SavedExpense } from "../types";

export async function saveExpense(payload: ExpenseSavePayload) {
  const response = await apiClient.post<SavedExpense>("/expenses/", payload);
  return response.data;
}
export async function fetchExpenses() {
  const response = await apiClient.get<SavedExpense[]>("/expenses/");
  return response.data;
}

export async function fetchExpenseDetail(id: number) {
  const response = await apiClient.get<SavedExpense>(`/expenses/${id}/`);
  return response.data;
}

export async function updateExpense(id: number, payload: ExpenseSavePayload) {
  const response = await apiClient.put<SavedExpense>(`/expenses/${id}/`, payload);
  return response.data;
}

export async function deleteExpense(id: number) {
  await apiClient.delete(`/expenses/${id}/`);
}

export async function fetchMonthlySummary(year: number, month: number) {
  const response = await apiClient.get<MonthlySummaryResponse>(`/summary/monthly/`, {
    params: { year, month },
  });
  return response.data;
}
