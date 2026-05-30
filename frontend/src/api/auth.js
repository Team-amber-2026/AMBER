import apiClient from "./client";

export async function fetchCurrentUser() {
  const response = await apiClient.get("/auth/user/");
  return response.data;
}

export async function registerUser({ username, email, password }) {
  const response = await apiClient.post("/auth/register/", {
    username,
    email,
    password,
  });
  return response.data;
}

export async function loginUser({ username, password }) {
  const response = await apiClient.post("/auth/login/", {
    username,
    password,
  });
  return response.data;
}

export async function logoutUser() {
  await apiClient.post("/auth/logout/");
}
