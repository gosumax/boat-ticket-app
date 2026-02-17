import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const STORAGE_KEY = "last_logins";
const REMEMBER_KEY = "remember_login_v1";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loadingAuth, currentUser } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedLogins, setSavedLogins] = useState([]);

  // загрузка сохранённых логинов
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setSavedLogins(stored);
    // 1) если есть сохранённые учётные данные (логин+пароль) — подставляем их
    try {
      const remembered = JSON.parse(localStorage.getItem(REMEMBER_KEY) || "null");
      if (remembered && typeof remembered === 'object') {
        if (remembered.username) setUsername(String(remembered.username));
        if (remembered.password) setPassword(String(remembered.password));
        setRememberPassword(true);
        return;
      }
    } catch {}

    // 2) иначе — подставляем последний логин из истории
    if (stored.length > 0) setUsername(stored[0]);
  }, []);

  // если уже залогинен — уходим
  useEffect(() => {
    if (!loadingAuth && currentUser) {
      navigate("/", { replace: true });
    }
  }, [loadingAuth, currentUser, navigate]);

  const saveLogin = (loginName) => {
    setSavedLogins((prev) => {
      const next = [loginName, ...prev.filter((l) => l !== loginName)].slice(
        0,
        10 // максимум 10 логинов
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(username, password);
      saveLogin(username);

      // remember password (optional)
      if (rememberPassword) {
        localStorage.setItem(
          REMEMBER_KEY,
          JSON.stringify({ username: String(username || ''), password: String(password || '') })
        );
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch (e) {
      setError(e?.message || "Ошибка входа");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingAuth) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white p-6 rounded shadow"
      >
        <h1 className="text-xl font-semibold mb-4 text-center">
          Вход в систему
        </h1>

        {error && (
          <div className="mb-3 p-2 rounded bg-red-100 text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* ЛОГИН */}
        <div className="mb-3">
          <label className="block text-sm mb-1">Логин</label>

          <input
            list="saved-logins"
            className="w-full border rounded p-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
            data-testid="login-username"
          />

          <datalist id="saved-logins">
            {savedLogins.map((login) => (
              <option key={login} value={login} />
            ))}
          </datalist>
        </div>

        {/* ПАРОЛЬ */}
        <div className="mb-4">
          <label className="block text-sm mb-1">Пароль</label>
          <input
            type="password"
            className="w-full border rounded p-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            data-testid="login-password"
          />
        </div>

        {/* REMEMBER */}
        <label className="flex items-center gap-2 mb-4 text-sm select-none">
          <input
            type="checkbox"
            checked={rememberPassword}
            onChange={(e) => {
              const checked = !!e.target.checked;
              setRememberPassword(checked);
              if (!checked) {
                try { localStorage.removeItem(REMEMBER_KEY); } catch {}
              }
            }}
          />
          Запомнить пароль
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-black text-white rounded p-2 disabled:opacity-60"
          data-testid="login-submit"
        >
          {submitting ? "Вход..." : "Войти"}
        </button>
      </form>
    </div>
  );
}
