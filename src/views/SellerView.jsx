import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SelectBoatType from '../components/seller/SelectBoatType';
import SelectTrip from '../components/seller/SelectTrip';
import SelectSeats from '../components/seller/SelectSeats';
import ConfirmationScreen from '../components/seller/ConfirmationScreen';
import SalesHistory from '../components/seller/SalesHistory';
import Toast from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { useOwnerData } from '../contexts/OwnerDataContext';
import {
  SellerScreen,
  SellerStepper,
  SellerTopbar,
  sellerContentClass,
} from '../components/seller/sellerUi';
import SellerTelegramGlobalAlertBanner from '../components/seller/telegram/SellerTelegramGlobalAlertBanner';
import apiClient from '../utils/apiClient';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isTripSellable(trip, cutoffMinutes = 10) {
  try {
    const dateStr = trip?.trip_date;
    const timeStr = trip?.time;
    if (!dateStr || !timeStr) return true;
    const start = new Date(`${dateStr}T${timeStr}:00`);
    if (Number.isNaN(start.getTime())) return true;
    const cutoffMs = cutoffMinutes * 60 * 1000;
    return Date.now() < start.getTime() - cutoffMs;
  } catch {
    return true;
  }
}

function getBoatTypeLabel(type) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'speed':
      return 'Скоростной катер';
    case 'cruise':
      return 'Прогулка';
    case 'banana':
      return 'Банан';
    default:
      return 'Новый предзаказ';
  }
}

const SellerView = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { refreshOwnerData } = useOwnerData();

  const [currentStep, setCurrentStep] = useState(1);
  const [boats, setBoats] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [numberOfSeats, setNumberOfSeats] = useState(1);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [showSalesHistory, setShowSalesHistory] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [prepaymentStr, setPrepaymentStr] = useState('');
  const [ticketInfo, setTicketInfo] = useState(null);
  const [prepaymentMethod, setPrepaymentMethod] = useState(null);
  const [prepaymentCashStr, setPrepaymentCashStr] = useState('');
  const [prepaymentCardStr, setPrepaymentCardStr] = useState('');
  const [prepaymentMethodError, setPrepaymentMethodError] = useState('');
  const [toast, setToast] = useState(null);

  const isLoadingTripsRef = useRef(false);

  const wizardSteps = useMemo(
    () => [
      { id: 1, label: 'Тип лодки' },
      { id: 2, label: 'Рейс' },
      { id: 3, label: 'Клиент и оплата' },
      { id: 4, label: 'Передача' },
    ],
    [],
  );

  const headerSubtitle = useMemo(() => {
    if (currentStep === 1) return 'Выбор типа лодки';
    if (currentStep === 2) {
      return selectedType ? getBoatTypeLabel(selectedType) : 'Выбор рейса';
    }
    if (currentStep === 3) {
      if (selectedTrip?.boat_name && selectedTrip?.time) {
        return `${selectedTrip.boat_name} · ${selectedTrip.time}`;
      }
      return 'Клиент, предоплата и способ оплаты';
    }
    return 'Оформление продажи';
  }, [currentStep, selectedTrip, selectedType]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  const handleBack = () => {
    setCurrentStep((prev) => {
      if (prev <= 0) return 0;

      if (prev === 1) {
        setSelectedType(null);
        return 0;
      }

      if (prev === 2) {
        setSelectedTrip(null);
        setTrips([]);
        return 1;
      }

      if (prev === 3) {
        setNumberOfSeats(1);
        return 2;
      }

      if (prev === 4) {
        return 3;
      }

      return prev - 1;
    });
  };

  const handleStepperStepClick = (targetStep) => {
    const target = Number(targetStep);
    if (!Number.isFinite(target) || target >= currentStep) return;

    if (target <= 1) {
      setSelectedTrip(null);
      setTrips([]);
      setNumberOfSeats(1);
      setTicketInfo(null);
      setCurrentStep(1);
      return;
    }

    if (target === 2) {
      setNumberOfSeats(1);
      setTicketInfo(null);
      setCurrentStep(2);
      return;
    }

    if (target === 3) {
      setTicketInfo(null);
      setCurrentStep(3);
    }
  };

  const handleSelectBoatType = (type) => {
    if (!type) {
      setSelectedType(null);
      navigate('/seller/home');
      return;
    }

    setSelectedType(type);
    setSelectedTrip(null);
    setTrips([]);
    setCurrentStep(2);
  };

  const handleTripSelect = (trip) => {
    setSelectedTrip(trip);
    setCurrentStep(3);
  };

  const handleCreatePresale = async (payload) => {
    try {
      setLoading(true);
      const res = await apiClient.createPresale(payload);
      setTicketInfo(res || null);
      setToast({ type: 'success', message: 'Предзаказ создан' });

      try {
        refreshOwnerData();
      } catch {
        // best-effort refresh only
      }
    } catch (err) {
      console.error('Create presale error:', err);
      setToast({ type: 'error', message: 'Не удалось создать предзаказ' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadBoats = async () => {
      try {
        const res = await (apiClient.get ? apiClient.get('/boats/active') : Promise.resolve([]));
        const activeBoats = res?.data ?? res;
        setBoats(activeBoats || []);
      } catch (error) {
        console.error('Error loading boats:', error);
      }
    };

    loadBoats();
  }, []);

  useEffect(() => {
    const loadTrips = async () => {
      if (!selectedType) return;
      if (currentStep < 2) return;
      if (isLoadingTripsRef.current) return;

      isLoadingTripsRef.current = true;

      try {
        setLoading(true);
        const res = await apiClient.getBoatSlotsByType(selectedType);
        const slots = res?.slots || res || [];
        const arr = Array.isArray(slots) ? slots : [];
        const byDate = arr.filter((trip) => !trip?.trip_date || trip.trip_date === selectedDate);
        const sellable = byDate.filter((trip) => isTripSellable(trip, 10));
        setTrips(sellable);
      } catch (error) {
        console.error('Error loading trips:', error);
      } finally {
        setLoading(false);
        isLoadingTripsRef.current = false;
      }
    };

    loadTrips();

    if (currentStep === 2 && selectedType) {
      const intervalId = setInterval(() => {
        loadTrips();
      }, 5000);

      return () => {
        clearInterval(intervalId);
      };
    }

    return undefined;
  }, [selectedType, selectedDate, currentStep]);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <SelectBoatType
            selectedType={selectedType}
            onSelect={handleSelectBoatType}
            onBack={() => {
              setSelectedType(null);
              navigate('/seller/home');
            }}
          />
        );

      case 2:
        return (
          <SelectTrip
            trips={trips}
            onSelect={handleTripSelect}
            onBack={handleBack}
            loading={loading}
            selectedDate={selectedDate}
            onDateChange={(iso) => setSelectedDate(iso)}
          />
        );

      case 3:
        return (
          <SelectSeats
            trip={selectedTrip}
            onBack={handleBack}
            onConfirm={async () => {
              const prepay = Math.max(0, parseInt(prepaymentStr || '0', 10) || 0);

              if (prepay > 0) {
                if (!prepaymentMethod) {
                  setPrepaymentMethodError('Выберите способ оплаты предоплаты');
                  return;
                }

                if (prepaymentMethod === 'mixed') {
                  const cash = Math.round(Number(prepaymentCashStr || 0));
                  const card = Math.round(Number(prepaymentCardStr || 0));

                  if (cash + card !== prepay) {
                    setPrepaymentMethodError('Сумма Нал + Карта должна быть равна предоплате');
                    return;
                  }

                  if (cash === 0 || card === 0) {
                    setPrepaymentMethodError('Для комбо укажите суммы и для налички, и для карты');
                    return;
                  }
                }

                setPrepaymentMethodError('');
              }

              const payload = {
                slotUid: selectedTrip?.slot_uid,
                customerName,
                customerPhone,
                numberOfSeats,
                prepaymentAmount: prepay,
              };

              if (prepay > 0) {
                if (prepaymentMethod === 'cash') {
                  payload.payment_method = 'CASH';
                } else if (prepaymentMethod === 'card') {
                  payload.payment_method = 'CARD';
                } else if (prepaymentMethod === 'mixed') {
                  payload.payment_method = 'MIXED';
                  payload.cash_amount = Math.round(Number(prepaymentCashStr || 0));
                  payload.card_amount = Math.round(Number(prepaymentCardStr || 0));
                }
              }

              await handleCreatePresale(payload);
              setCurrentStep(4);
            }}
            numberOfSeats={numberOfSeats}
            setNumberOfSeats={setNumberOfSeats}
            customerName={customerName}
            setCustomerName={setCustomerName}
            customerPhone={customerPhone}
            setCustomerPhone={setCustomerPhone}
            prepaymentStr={prepaymentStr}
            setPrepaymentStr={setPrepaymentStr}
            prepaymentMethod={prepaymentMethod}
            setPrepaymentMethod={setPrepaymentMethod}
            prepaymentCashStr={prepaymentCashStr}
            setPrepaymentCashStr={setPrepaymentCashStr}
            prepaymentCardStr={prepaymentCardStr}
            setPrepaymentCardStr={setPrepaymentCardStr}
            prepaymentMethodError={prepaymentMethodError}
            setPrepaymentMethodError={setPrepaymentMethodError}
            isSubmitting={loading}
          />
        );

      case 4:
        return (
          <ConfirmationScreen
            ticketInfo={ticketInfo}
            trip={selectedTrip}
            numberOfSeats={numberOfSeats}
            customerName={customerName}
            customerPhone={customerPhone}
            prepaymentAmount={Math.max(0, parseInt(prepaymentStr || '0', 10) || 0)}
            onBack={() => {
              setTicketInfo(null);
              setCurrentStep(3);
            }}
            onConfirm={() => {
              setTicketInfo(null);
              setCurrentStep(0);
            }}
            onPresaleCancel={() => {
              setTicketInfo(null);
              setCurrentStep(0);
            }}
          />
        );

      default:
        navigate('/seller/home');
        return null;
    }
  };

  if (showSalesHistory) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
          <div className="w-16" />
          <h1 className="text-xl font-bold">Продавец</h1>
          <button
            onClick={handleLogout}
            className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded font-medium transition-colors"
          >
            Выйти
          </button>
        </div>

        <SellerTelegramGlobalAlertBanner />

        <div className="p-4 max-w-md mx-auto">
          <SalesHistory onBack={() => setShowSalesHistory(false)} />
        </div>
      </div>
    );
  }

  if (currentStep === 4) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
          <div className="w-16" />
          <h1 className="text-xl font-bold">Продавец</h1>
          <button
            onClick={handleLogout}
            className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded font-medium transition-colors"
          >
            Выйти
          </button>
        </div>

        <SellerTelegramGlobalAlertBanner />

        <div className="bg-white border-b border-gray-200">
          <div className="max-w-md mx-auto px-4 py-3">
            <SellerStepper steps={wizardSteps} currentStep={currentStep} onStepClick={handleStepperStepClick} />
          </div>
        </div>

        <div className="p-4 max-w-md mx-auto">
          {renderStep()}
        </div>

        {toast ? <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} /> : null}
      </div>
    );
  }

  return (
    <SellerScreen>
      <SellerTopbar
        title="Продажа билета"
        subtitle={headerSubtitle}
        onBack={currentStep <= 1 ? () => navigate('/seller/home') : handleBack}
        onLogout={handleLogout}
      />

      <SellerTelegramGlobalAlertBanner />

      <div className={`${sellerContentClass} space-y-3`}>
        <SellerStepper steps={wizardSteps} currentStep={currentStep} onStepClick={handleStepperStepClick} />
        {renderStep()}
      </div>

      {toast ? <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} /> : null}
    </SellerScreen>
  );
};

export default SellerView;
