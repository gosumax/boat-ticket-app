import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  SellerHeroPanel,
  SellerScreen,
  SellerSurface,
  SellerTopbar,
  sellerContentClass,
  sellerHelperTextClass,
} from '../components/seller/sellerUi';
import SellerTelegramGlobalAlertBanner from '../components/seller/telegram/SellerTelegramGlobalAlertBanner';

const SellerMedia = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <SellerScreen>
      <SellerTopbar
        title="Фото|видео"
        subtitle="Материалы"
        onBack={() => navigate('/seller/home')}
        onLogout={handleLogout}
      />

      <SellerTelegramGlobalAlertBanner />

      <div className={`${sellerContentClass} space-y-3`}>
        <SellerHeroPanel>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">Материалы</div>
          <div className="mt-3 text-[34px] font-semibold leading-none tracking-[-0.04em] text-white">Фото и видео</div>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-200">
            Здесь будут собраны материалы для работы и показа клиентам.
          </p>
        </SellerHeroPanel>

        <SellerSurface>
          <h2 className="text-lg font-semibold text-slate-900">Материалы скоро появятся</h2>
          <p className={`mt-2 ${sellerHelperTextClass}`}>
            Раздел наполняется. Чуть позже здесь появятся фото и видео.
          </p>
        </SellerSurface>
      </div>
    </SellerScreen>
  );
};

export default SellerMedia;
