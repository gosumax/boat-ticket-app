import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SellTicketScreen from '../components/seller/SellTicketScreen';
import SelectBoatType from '../components/seller/SelectBoatType';
import SelectTrip from '../components/seller/SelectTrip';
import SelectSeats from '../components/seller/SelectSeats';
import ConfirmationScreen from '../components/seller/ConfirmationScreen';
import SalesHistory from '../components/seller/SalesHistory';
import apiClient from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import Toast from '../components/Toast';

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


function isTripSellable(trip, cutoffMinutes = 10) {
  // Hide trips starting in <= cutoffMinutes or already started.
  try {
    const dateStr = trip?.trip_date;
    const timeStr = trip?.time;
    if (!dateStr || !timeStr) return true;
    const start = new Date(`${dateStr}T${timeStr}:00`);
    if (Number.isNaN(start.getTime())) return true;
    const cutoffMs = cutoffMinutes * 60 * 1000;
    return Date.now() < (start.getTime() - cutoffMs);
  } catch {
    return true;
  }
}

const SellerView = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const [currentStep, setCurrentStep] = useState(0);

  const [boats, setBoats] = useState([]);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);

  const [selectedType, setSelectedType] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [numberOfSeats, setNumberOfSeats] = useState(1);

  // Date filter for trips (YYYY-MM-DD)
  const [selectedDate, setSelectedDate] = useState(todayISO);

  // Sales history modal/view
  const [showSalesHistory, setShowSalesHistory] = useState(false);

  // Presale / customer
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [prepaymentStr, setPrepaymentStr] = useState('');
  const [ticketInfo, setTicketInfo] = useState(null);

  // UI toast
  const [toast, setToast] = useState(null);

  const steps = useMemo(() => ([
    { id: 0, label: 'Продать' },
    { id: 1, label: 'Тип' },
    { id: 2, label: 'Рейс' },
    { id: 3, label: 'Места' },
    { id: 4, label: 'Подтвердить' },
  ]), []);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  // Back logic: MUST also reset related state so step doesn't "snap back"
  const handleBack = () => {
    setCurrentStep(prev => {
      if (prev <= 0) return 0;

      if (prev === 1) {
        // Type -> Sell
        setSelectedType(null);
        return 0;
      }

      if (prev === 2) {
        // Trip -> Type
        setSelectedTrip(null);
        setTrips([]);
        return 1;
      }

      if (prev === 3) {
        // Seats -> Trip
        setNumberOfSeats(1);
        return 2;
      }

      if (prev === 4) {
        // Confirm -> Seats
        return 3;
      }

      return prev - 1;
    });
  };

  const handleSellTicket = () => {
    // start flow
    setSelectedType(null);
    setSelectedTrip(null);
    setTrips([]);
    setNumberOfSeats(1);
    setCustomerName('');
    setCustomerPhone('');
    setTicketInfo(null);
    setPrepaymentStr('');
    setSelectedDate(todayISO());
    setCurrentStep(1);
  };

  const handleSelectBoatType = (type) => {
    if (!type) {
      // back from Type screen
      setSelectedType(null);
      setCurrentStep(0);
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

  const handleSeatsConfirm = (seats) => {
    setNumberOfSeats(seats);
    setCurrentStep(4);
  };

  const handleCreatePresale = async (payload) => {
    try {
      setLoading(true);
      const res = await apiClient.createPresale(payload);
      const presale = res?.presale || res;
      setTicketInfo(presale);
      setToast({ type: 'success', message: 'Предзаказ создан' });
      // stay on confirmation screen (same step, UI is within step 4 component)
    } catch (err) {
      console.error('Create presale error:', err);
      setToast({ type: 'error', message: 'Не удалось создать предзаказ' });
    } finally {
      setLoading(false);
    }
  };

  // Load boats (optional, but keep as in your logs)
  useEffect(() => {
    const loadBoats = async () => {
      try {
        const activeBoats = await apiClient.getActiveBoats();
        setBoats(activeBoats || []);
      } catch (e) {
        console.error('Error loading boats:', e);
      }
    };
    loadBoats();
  }, []);

  // Load trips whenever type/date changes AND we are on trip step (or later)
  useEffect(() => {
    const loadTrips = async () => {
      if (!selectedType) return;
      if (currentStep < 2) return;

      setLoading(true);
      try {
        const res = await apiClient.getBoatSlotsByType(selectedType);
        const slots = res?.slots || res || [];
        const arr = Array.isArray(slots) ? slots : [];
        // Filter by selectedDate if backend provides trip_date
        const byDate = arr.filter(t => !t?.trip_date || t.trip_date === selectedDate);
        const sellable = byDate.filter(t => isTripSellable(t, 10));
        setTrips(sellable);
      } catch (e) {
        console.error('Error loading trips:', e);
        setTrips([]);
      } finally {
        setLoading(false);
      }
    };

    loadTrips();
  }, [selectedType, selectedDate, currentStep]);

  // Show sales history overlay
  if (showSalesHistory) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
          <div className="w-16"></div>
          <h1 className="text-xl font-bold">Продавец</h1>
          <button
            onClick={handleLogout}
            className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded font-medium transition-colors"
          >
            Выйти
          </button>
        </div>

        <div className="p-4 max-w-md mx-auto">
          <SalesHistory onBack={() => setShowSalesHistory(false)} />
        </div>
      </div>
    );
  }

  const renderStep = () => {
    switch (currentStep) {
      case 0:
        return (
          <SellTicketScreen
            onSellTicket={handleSellTicket}
            onBack={() => navigate('/seller/home')}
            onShowSalesHistory={() => setShowSalesHistory(true)}
          />
        );

      case 1:
        return (
          <SelectBoatType
            selectedType={selectedType}
            onSelect={handleSelectBoatType}
            onBack={() => {
              setSelectedType(null);
              setCurrentStep(0);
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
              // Build payload from parent-held state (SelectSeats pushes updates via setters)
              const prepaymentAmount = Math.max(0, parseInt(prepaymentStr || '0', 10) || 0);

              await handleCreatePresale({
                slotUid: selectedTrip?.slot_uid,
                customerName,
                customerPhone,
                numberOfSeats,
                prepaymentAmount
              });

              // Success -> go to confirmation
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
        return (
          <SellTicketScreen
            onSellTicket={handleSellTicket}
            onBack={() => navigate('/seller/home')}
            onShowSalesHistory={() => setShowSalesHistory(true)}
          />
        );
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white p-4 flex justify-between items-center shadow-md">
        <div className="w-16"></div>
        <h1 className="text-xl font-bold">Продавец</h1>
        <button
          onClick={handleLogout}
          className="bg-blue-700 hover:bg-blue-800 text-white px-3 py-1 rounded font-medium transition-colors"
        >
          Выйти
        </button>
      </div>

      {/* Stepper */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex justify-between text-xs text-gray-600 mb-2">
            {steps.map(s => (
              <div key={s.id} className={currentStep === s.id ? 'text-blue-700 font-semibold' : ''}>
                {s.label}
              </div>
            ))}
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-2 bg-blue-600 rounded-full transition-all"
              style={{ width: `${(Math.min(currentStep, 4) / 4) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 max-w-md mx-auto">
        {renderStep()}
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

    </div>
  );
};

export default SellerView;