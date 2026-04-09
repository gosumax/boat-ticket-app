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
    <div className="relative min-h-screen overflow-hidden bg-[#070907] px-4 py-8 text-white sm:px-6">
      <style>{`
        @keyframes loginAurora {
          0% { transform: translate3d(-2%, -1%, 0) rotate(0deg) scale(1); background-position: 0% 50%; }
          50% { transform: translate3d(2%, 1%, 0) rotate(5deg) scale(1.04); background-position: 100% 50%; }
          100% { transform: translate3d(-1%, 2%, 0) rotate(-3deg) scale(1.02); background-position: 35% 50%; }
        }
      `}</style>

      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(135deg, #07100d 0%, #101713 34%, #191313 68%, #080d0b 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute -inset-24 opacity-80 blur-3xl motion-safe:animate-[loginAurora_20s_ease-in-out_infinite_alternate]"
        style={{
          backgroundImage:
            "conic-gradient(from 120deg at 34% 38%, rgba(67, 211, 176, 0.36), rgba(242, 199, 102, 0.2), rgba(244, 114, 182, 0.2), rgba(79, 156, 255, 0.2), rgba(67, 211, 176, 0.36))",
          backgroundSize: "150% 150%",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.2]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.52)_100%)]" />

      <div className="relative z-10 flex min-h-[calc(100vh-4rem)] items-center justify-center">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-[430px] rounded-lg border border-white/15 bg-[linear-gradient(180deg,rgba(19,27,24,0.92)_0%,rgba(7,10,9,0.9)_100%)] p-5 shadow-[0_28px_80px_-46px_rgba(0,0,0,0.95),0_0_46px_-28px_rgba(67,211,176,0.76)] backdrop-blur-2xl sm:p-7"
        >
          <div className="mb-7 text-center">
            <div className="text-sm font-semibold text-[#7ce7ca]">
              Море
            </div>
            <h1 className="mt-2 text-3xl font-semibold leading-tight text-white sm:text-4xl">
              Вход в систему
            </h1>
            <p className="mt-3 text-sm leading-6 text-[#b6c8bd]">
              Рейсы, продажи и смены
            </p>
          </div>

          {error && (
            <div className="mb-5 rounded-lg border border-[#ff8a94]/35 bg-[#3a1115]/85 px-4 py-3 text-sm text-[#ffd0d5] shadow-[0_18px_40px_-34px_rgba(255,138,148,0.8)]">
              {error}
            </div>
          )}

          {/* ЛОГИН */}
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-[#dbeee5]">Логин</label>

            <input
              list="saved-logins"
              className="w-full rounded-lg border border-white/15 bg-white/[0.07] px-4 py-3 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition placeholder:text-[#8fa197] hover:border-white/25 focus:border-[#6ee7c8]/70 focus:bg-white/[0.1] focus:ring-2 focus:ring-[#6ee7c8]/20"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              placeholder="Введите логин"
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
          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-[#dbeee5]">Пароль</label>
            <input
              type="password"
              className="w-full rounded-lg border border-white/15 bg-white/[0.07] px-4 py-3 text-[15px] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] outline-none transition placeholder:text-[#8fa197] hover:border-white/25 focus:border-[#6ee7c8]/70 focus:bg-white/[0.1] focus:ring-2 focus:ring-[#6ee7c8]/20"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="Введите пароль"
              required
              data-testid="login-password"
            />
          </div>

          {/* REMEMBER */}
          <label className="mb-6 flex items-center gap-3 text-sm text-[#c8d8d0] select-none">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/25 bg-white/10 accent-[#6ee7c8] focus:ring-2 focus:ring-[#6ee7c8]/25"
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
            className="w-full rounded-lg border border-[#b8f4df]/30 bg-[linear-gradient(135deg,#f2c766_0%,#43d3b0_52%,#4f9cff_100%)] px-4 py-3.5 text-[15px] font-semibold text-[#07100d] shadow-[0_18px_34px_-22px_rgba(67,211,176,0.8)] transition hover:brightness-110 active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f2c766]/40 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="login-submit"
          >
            {submitting ? "Вход..." : "Войти"}
          </button>
        </form>
      </div>
    </div>
  );
}
