// src/views/OwnerView.jsx
// MOBILE FIRST – один файл, целиком

import { useEffect, useState } from 'react';
import apiClient from '../utils/apiClient';

const OwnerView = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        setLoading(true);
        const res = await apiClient.getOwnerDashboard();
        if (mounted) setData(res || {});
      } catch (e) {
        if (mounted) setError(e?.message || 'Ошибка загрузки');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return <div className="p-4 text-center">Загрузка…</div>;
  }

  if (error) {
    return <div className="p-4 text-red-600">{error}</div>;
  }

  const today = data?.today || {};

  const revenueToday = today?.revenue || 0;
  const avgCheck = today?.avgCheck || 0;
  const fillPercent = today?.fillPercent || 0;

  const payments = today?.payments;
  const cash = payments?.cash ?? 0;
  const card = payments?.card ?? 0;
  const paymentsReady = Boolean(payments && payments.ready);
  const mismatch = paymentsReady && cash + card !== revenueToday;

  const byProduct = today?.byProduct || {};
  const revenueByDays = data?.revenueByDays || [];

  return (
    <div className="p-4 space-y-4">
      {/* ЗОНА A — ключевые показатели */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-xs text-gray-500">Выручка сегодня</div>
        <div className="text-3xl font-bold mt-1">{revenueToday} ₽</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-xs text-gray-500">Средний чек</div>
          <div className="text-xl font-bold mt-1">{avgCheck} ₽</div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-xs text-gray-500">Заполненность</div>
          <div className="text-xl font-bold mt-1">{fillPercent}%</div>
        </div>
      </div>

      {/* ЗОНА C — деньги по оплате */}
      <div
        className={`space-y-2 ${
          mismatch ? 'border border-red-400 rounded-xl p-2' : ''
        }`}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-xs text-gray-500">💵 Наличные</div>
            <div className="text-xl font-bold mt-1">{cash} ₽</div>
          </div>

          <div className="bg-white rounded-xl shadow p-4">
            <div className="text-xs text-gray-500">💳 Безнал</div>
            <div className="text-xl font-bold mt-1">{card} ₽</div>
          </div>
        </div>

        {paymentsReady && mismatch && (
          <div className="text-xs text-red-600 text-center">
            Есть платежи без типа оплаты
          </div>
        )}
        {!paymentsReady && (
          <div className="text-xs text-gray-400 text-center">
            Тип оплаты ещё не фиксируется
          </div>
        )}
      </div>

      {/* ЗОНА B — выручка по продуктам */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-xs text-gray-500">🚤 Скоростные</div>
          <div className="text-lg font-bold mt-1">
            {byProduct.speed || 0} ₽
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-xs text-gray-500">🛥 Прогулочные</div>
          <div className="text-lg font-bold mt-1">
            {byProduct.cruise || 0} ₽
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-xs text-gray-500">🍌 Банан</div>
          <div className="text-lg font-bold mt-1">
            {byProduct.banana || 0} ₽
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <div className="text-xs text-gray-500">🎣 Рыбалка</div>
          <div className="text-lg font-bold mt-1">
            {byProduct.fishing || 0} ₽
          </div>
        </div>
      </div>

      {/* ЗОНА D — выручка по дням */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="text-xs text-gray-500 mb-3">
          Выручка по дням
        </div>

        <div className="flex items-end gap-2 h-32">
          {revenueByDays.map((d, i) => {
            const value = d?.revenue || 0;
            const height = Math.max(6, value / 100);
            return (
              <div key={i} className="flex-1 flex flex-col justify-end">
                <div
                  className="bg-blue-500 rounded"
                  style={{ height: `${height}%` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default OwnerView;
