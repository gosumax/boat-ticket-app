import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

const STORAGE_KEY = "last_logins";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, loadingAuth, currentUser } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedLogins, setSavedLogins] = useState([]);

  // загрузка сохранённых логинов
  useEffect(() => {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    setSavedLogins(stored);
    if (stored.length > 0) {
      setUsername(stored[0]); // последний использованный
    }
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
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-black text-white rounded p-2 disabled:opacity-60"
        >
          {submitting ? "Вход..." : "Войти"}
        </button>
      </form>
    </div>
  );
}
