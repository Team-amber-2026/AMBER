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

export type ReceiptAnalyzeResult = {
  shop_name: string | null;
  purchased_at: string | null;
  total_amount: number | null;
  raw_ocr_text: string;
  image?: {
    name: string;
    size: number;
    content_type: string;
  };
  detail?: string;
};
