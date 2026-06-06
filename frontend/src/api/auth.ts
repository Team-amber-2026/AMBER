import apiClient from "./client";
import type { LoginForm, RegisterForm, User } from "../types";

export async function fetchCurrentUser() {
  const response = await apiClient.get<User>("/auth/user/");
  return response.data;
}

export async function registerUser({ username, email, password }: RegisterForm) {
  const response = await apiClient.post<User>("/auth/register/", {
    username,
    email,
    password,
  });
  return response.data;
}

export async function loginUser({ username, password }: LoginForm) {
  const response = await apiClient.post<User>("/auth/login/", {
    username,
    password,
  });
  return response.data;
}

export async function logoutUser() {
  await apiClient.post("/auth/logout/");
}
