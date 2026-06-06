export type User = {
  id: number;
  username: string;
  email: string;
};

export type LoginForm = {
  username: string;
  password: string;
};

export type RegisterForm = {
  username: string;
  email: string;
  password: string;
};

export type AuthMode = "login" | "register";

export type RecentExpense = {
  id: number;
  shopName: string;
  purchasedAt: string;
  category: string;
  totalAmount: number;
};

export type DashboardSummary = {
  totalAmount: number;
  receiptCount: number;
  recentExpenses: RecentExpense[];
};
