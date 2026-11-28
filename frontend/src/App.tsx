import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import { fetchCurrentUser, loginUser, logoutUser, registerUser } from "./api/auth";
import apiClient from "./api/client";
import AuthPage from "./pages/AuthPage";
import TopPage from "./pages/TopPage";
import MyPage from "./pages/MyPage";
import HomePage from "./pages/HomePage";
import ReceiptCompletePage from "./pages/ReceiptCompletePage";
import ReceiptUploadPage from "./pages/ReceiptUploadPage";
import ExpenseListPage from "./pages/ExpenseListPage";
import ExpenseDetailPage from "./pages/ExpenseDetailPage";
import ExpenseEditPage from "./pages/ExpenseEditPage";
import MonthlySummaryPage from "./pages/MonthlySummaryPage";
import type { AuthMode, LoginForm, RegisterForm, User } from "./types";
import { isUnauthenticated, readableError } from "./utils/errors";
import styles from "./App.module.css";

const initialLogin: LoginForm = {
  username: "",
  password: "",
};

const initialRegister: RegisterForm = {
  username: "",
  email: "",
  password: "",
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginForm, setLoginForm] = useState<LoginForm>(initialLogin);
  const [registerForm, setRegisterForm] = useState<RegisterForm>(initialRegister);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();
  const logoutInFlight = useRef(false);

  // Install before protected pages start fetching in their mount effects.
  useLayoutEffect(() => {
    if (!user) return;

    let active = true;
    const interceptor = apiClient.interceptors.response.use(undefined, (error: unknown) => {
      if (active && isUnauthenticated(error)) {
        active = false;
        setUser(null);
        setError("");
        setMessage("セッションが切れました。再度ログインしてください");
      }
      return Promise.reject(error);
    });

    return () => {
      // Axios retains the interceptor chain on already-dispatched requests.
      active = false;
      apiClient.interceptors.response.eject(interceptor);
    };
  }, [user]);

  useEffect(() => {
    let active = true;
    async function initializeAuth() {
      try {
        const currentUser = await fetchCurrentUser();
        if (active) setUser(currentUser);
      } catch (requestError) {
        if (active && !isUnauthenticated(requestError)) {
          setError(readableError(requestError));
        }
      } finally {
        if (active) setAuthChecked(true);
      }
    }

    void initializeAuth();
    return () => { active = false; };
  }, []);

  async function handleRegister() {
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      await registerUser(registerForm);
      setRegisterForm(initialRegister);
      setMessage("登録が完了しました。ログインしてください。");
      return true;
    } catch (requestError) {
      setError(readableError(requestError));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogin() {
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const loggedInUser = await loginUser(loginForm);
      setUser(loggedInUser);
      setLoginForm(initialLogin);
      setMessage("ログインしました。");
      return true;
    } catch (requestError) {
      setError(readableError(requestError));
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleLogout() {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      await logoutUser();
      setUser(null);
      setLoginForm(initialLogin);
      setRegisterForm(initialRegister);
      setMessage("ログアウトしました。");
      navigate("/login", { replace: true });
    } catch (requestError) {
      if (!isUnauthenticated(requestError)) setError(readableError(requestError));
    } finally {
      logoutInFlight.current = false;
      setIsSubmitting(false);
    }
  }

  if (!authChecked) {
    return <main className={styles.loadingShell}>読み込み中...</main>;
  }

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/home" replace /> : <TopPage error={error} />} />
      <Route
        path="/login"
        element={renderAuthRoute({
          mode: "login",
          user,
          loginForm,
          registerForm,
          message,
          error,
          isSubmitting,
          onLogin: handleLogin,
          onRegister: handleRegister,
          setLoginForm,
          setRegisterForm,
        })}
      />
      <Route
        path="/register"
        element={renderAuthRoute({
          mode: "register",
          user,
          loginForm,
          registerForm,
          message,
          error,
          isSubmitting,
          onLogin: handleLogin,
          onRegister: handleRegister,
          setLoginForm,
          setRegisterForm,
        })}
      />
      <Route
        path="/home"
        element={
          user ? (
            <HomePage
              user={user}
              message={message}
              error={error}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/receipts/new"
        element={
          <ProtectedRoute user={user}>
            <ReceiptUploadPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses"
        element={
          <ProtectedRoute user={user}>
            <ExpenseListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/summary"
        element={
          <ProtectedRoute user={user}>
            <MonthlySummaryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/:expenseId/edit"
        element={
          <ProtectedRoute user={user}>
            <ExpenseEditPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/expenses/:expenseId"
        element={
          <ProtectedRoute user={user}>
            <ExpenseDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/receipts/complete"
        element={
          <ProtectedRoute user={user}>
            <ReceiptCompletePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mypage"
        element={
          user ? (
            <MyPage user={user} error={error} isSubmitting={isSubmitting} onLogout={handleLogout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to={user ? "/home" : "/"} replace />} />
    </Routes>
  );
}

type AuthRouteProps = {
  mode: AuthMode;
  user: User | null;
  loginForm: LoginForm;
  registerForm: RegisterForm;
  message: string;
  error: string;
  isSubmitting: boolean;
  onLogin: () => Promise<boolean>;
  onRegister: () => Promise<boolean>;
  setLoginForm: Dispatch<SetStateAction<LoginForm>>;
  setRegisterForm: Dispatch<SetStateAction<RegisterForm>>;
};

function renderAuthRoute(props: AuthRouteProps) {
  if (props.user) {
    return <Navigate to="/home" replace />;
  }

  return <AuthPage {...props} />;
}

function ProtectedRoute({ user, children }: { user: User | null; children: ReactNode }) {
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
