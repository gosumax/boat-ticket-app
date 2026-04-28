import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  SellerScreen,
  SellerSurface,
  SellerTopbar,
  sellerChoiceCardClass,
  sellerContentClass,
  sellerHelperTextClass,
} from '../components/seller/sellerUi';
import SellerTelegramGlobalAlertBanner, {
  SELLER_TELEGRAM_REQUESTS_ROUTE,
} from '../components/seller/telegram/SellerTelegramGlobalAlertBanner';

const MENU_CARD_TONES = {
  sell: {
    backgroundImage: 'linear-gradient(135deg,#3f0a0a 0%,#7f1d1d 38%,#b91c1c 70%,#5f1111 100%)',
    boxShadow: '0 30px 60px -28px rgba(185,28,28,0.86), 0 0 32px -12px rgba(248,113,113,0.72)',
    description: 'text-rose-50/90',
    button: 'bg-white text-rose-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)] group-hover:bg-rose-50',
  },
  earnings: {
    backgroundImage: 'linear-gradient(135deg,#052e16 0%,#047857 46%,#22c55e 100%)',
    boxShadow: '0 30px 60px -28px rgba(5,150,105,0.86), 0 0 32px -12px rgba(74,222,128,0.58)',
    description: 'text-emerald-50/90',
    button: 'bg-white text-emerald-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)] group-hover:bg-emerald-50',
  },
  media: {
    backgroundImage: 'linear-gradient(135deg,#2e1065 0%,#6d28d9 48%,#a855f7 100%)',
    boxShadow: '0 30px 60px -28px rgba(109,40,217,0.86), 0 0 32px -12px rgba(168,85,247,0.62)',
    description: 'text-violet-50/90',
    button: 'bg-white text-violet-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)] group-hover:bg-violet-50',
  },
  requests: {
    backgroundImage: 'linear-gradient(135deg,#7c2d12 0%,#c2410c 42%,#f97316 100%)',
    boxShadow: '0 30px 60px -28px rgba(194,65,12,0.84), 0 0 32px -12px rgba(251,146,60,0.62)',
    description: 'text-orange-50/90',
    button: 'bg-white text-orange-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)] group-hover:bg-orange-50',
  },
};

function MenuCard({ title, description, accent, onClick, testId, featured = false, tone = null }) {
  const cardTone = MENU_CARD_TONES[tone || (featured ? 'sell' : '')];
  const isAccent = Boolean(cardTone);

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={sellerChoiceCardClass({
        className: `group relative flex min-h-[138px] flex-col overflow-hidden p-5 ${
          featured
            ? 'border-transparent min-h-[154px] p-6 sm:min-h-0 sm:p-5'
            : 'sm:min-h-0 sm:p-4'
        }`,
      })}
      style={
        cardTone
          ? {
              backgroundImage: cardTone.backgroundImage,
              boxShadow: cardTone.boxShadow,
            }
          : undefined
      }
    >
      <div
        className="absolute inset-x-0 top-0 h-1.5 rounded-t-[26px]"
        style={{ background: accent }}
        aria-hidden="true"
      />
      <div className="flex h-full items-start justify-between gap-4">
        <div className="min-w-0">
          <div
            className={`${
              isAccent
                ? `${featured ? 'text-xl sm:text-lg' : 'text-lg sm:text-base'} text-white`
                : 'text-lg text-slate-950 sm:text-base'
            } font-semibold`}
          >
            {title}
          </div>
          <p
            className={`mt-3 text-[15px] leading-6 sm:mt-2 sm:text-sm sm:leading-5 ${
              isAccent ? cardTone.description : 'text-slate-500'
            }`}
          >
            {description}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors sm:px-2.5 sm:py-1 sm:text-xs ${
            isAccent
              ? cardTone.button
              : 'bg-slate-100 text-slate-600 group-hover:bg-slate-950 group-hover:text-white'
          }`}
        >
          Открыть
        </span>
      </div>
    </button>
  );
}

const SellerHome = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <SellerScreen data-testid="seller-home-screen">
      <SellerTopbar title="Продавец" subtitle="Рабочее место" onLogout={handleLogout} />

      <SellerTelegramGlobalAlertBanner />

      <div className={`${sellerContentClass} flex min-h-[calc(100svh-73px)] flex-col space-y-3 sm:min-h-0`}>
        <SellerSurface className="flex min-h-[62svh] flex-col p-5 sm:min-h-0 sm:flex-none sm:p-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Главное меню</h2>
            <p className={`mt-1 ${sellerHelperTextClass}`}>Выберите нужный раздел.</p>
          </div>

          <div className="mt-4 flex flex-col gap-3.5 space-y-0 sm:mt-4 sm:block sm:space-y-3">
            <MenuCard
              title="Продать билет"
              description="Открыть оформление продажи и выбрать рейс."
              accent="linear-gradient(90deg,#fecaca 0%,#fb7185 38%,#ef4444 100%)"
              onClick={() => navigate('/seller?start=type')}
              testId="seller-home-sell-btn"
              featured
            />
            <MenuCard
              title="Мои продажи"
              description="Посмотреть продажи, начисления и детали по билетам."
              accent="linear-gradient(135deg,#0f172a 0%,#0f766e 100%)"
              onClick={() => navigate('/seller/earnings')}
              testId="seller-home-earnings-btn"
              tone="earnings"
            />
            <MenuCard
              title="Мои заявки"
              description="Очередь входящих заявок из подключённых каналов."
              accent="linear-gradient(135deg,#7c2d12 0%,#f97316 100%)"
              onClick={() => navigate(SELLER_TELEGRAM_REQUESTS_ROUTE)}
              testId="seller-home-requests-btn"
              tone="requests"
            />
            <MenuCard
              title="Фото|видео"
              description="Материалы для работы и показа клиентам."
              accent="linear-gradient(135deg,#0f172a 0%,#7c3aed 100%)"
              onClick={() => navigate('/seller/media')}
              testId="seller-home-media-btn"
              tone="media"
            />
          </div>
        </SellerSurface>
      </div>
    </SellerScreen>
  );
};

export default SellerHome;
