import {
  SellerSurface,
  sellerButtonClass,
  sellerHelperTextClass,
} from './sellerUi';

const BOAT_OPTIONS = [
  {
    key: 'speed',
    title: 'Скоростной катер',
    subtitle: 'Быстрые рейсы с акцентом на время отправления и посадку.',
    accent: 'bg-sky-400 shadow-[0_0_18px_rgba(56,189,248,0.7)]',
    card: 'border-blue-500/70 bg-[linear-gradient(135deg,#082f49_0%,#1d4ed8_48%,#38bdf8_100%)] text-white shadow-[0_26px_48px_-24px_rgba(37,99,235,0.88)] hover:border-sky-300 hover:brightness-[1.04] hover:shadow-[0_30px_54px_-24px_rgba(37,99,235,0.96)]',
    selectedCard: 'border-sky-200 bg-[linear-gradient(135deg,#0f172a_0%,#2563eb_48%,#7dd3fc_100%)] text-white shadow-[0_30px_58px_-24px_rgba(14,165,233,0.98)] ring-2 ring-sky-200/35',
    text: 'text-sky-50/90',
    selectedText: 'text-sky-50',
    badge: 'bg-white/16 text-white ring-1 ring-white/25',
    selectedBadge: 'bg-white text-blue-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)]',
  },
  {
    key: 'cruise',
    title: 'Прогулка',
    subtitle: 'Спокойные прогулочные рейсы с комфортной посадкой.',
    accent: 'bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.68)]',
    card: 'border-emerald-500/70 bg-[linear-gradient(135deg,#064e3b_0%,#059669_50%,#86efac_100%)] text-white shadow-[0_26px_48px_-24px_rgba(16,185,129,0.86)] hover:border-lime-200 hover:brightness-[1.04] hover:shadow-[0_30px_54px_-24px_rgba(16,185,129,0.94)]',
    selectedCard: 'border-lime-200 bg-[linear-gradient(135deg,#052e16_0%,#16a34a_50%,#bef264_100%)] text-white shadow-[0_30px_58px_-24px_rgba(34,197,94,0.98)] ring-2 ring-lime-200/35',
    text: 'text-emerald-50/90',
    selectedText: 'text-emerald-50',
    badge: 'bg-white/16 text-white ring-1 ring-white/25',
    selectedBadge: 'bg-white text-emerald-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)]',
  },
  {
    key: 'banana',
    title: 'Банан',
    subtitle: 'Короткий активный формат с быстрым выбором мест и цены.',
    accent: 'bg-yellow-300 shadow-[0_0_18px_rgba(250,204,21,0.74)]',
    card: 'border-yellow-400 bg-[linear-gradient(135deg,#ca8a04_0%,#eab308_48%,#fef08a_100%)] text-yellow-950 shadow-[0_26px_48px_-24px_rgba(250,204,21,0.9)] hover:border-yellow-200 hover:brightness-[1.04] hover:shadow-[0_30px_54px_-24px_rgba(250,204,21,0.98)]',
    selectedCard: 'border-yellow-200 bg-[linear-gradient(135deg,#a16207_0%,#facc15_50%,#fef9c3_100%)] text-yellow-950 shadow-[0_30px_58px_-24px_rgba(250,204,21,1)] ring-2 ring-yellow-200/45',
    text: 'text-yellow-950/80',
    selectedText: 'text-yellow-950',
    badge: 'bg-white/40 text-yellow-950 ring-1 ring-yellow-100/70',
    selectedBadge: 'bg-white/80 text-yellow-950 shadow-[0_14px_28px_-18px_rgba(255,255,255,0.85)]',
  },
];

const SelectBoatType = ({ selectedType, onSelect, onBack }) => {
  return (
    <div className="space-y-3" data-testid="seller-select-type-screen">
      <SellerSurface>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Выберите тип лодки</h2>
        </div>

        <div className="mt-4 space-y-3">
          {BOAT_OPTIONS.map((option) => {
            const isSelected = selectedType === option.key;

            return (
              <button
                key={option.key}
                type="button"
                data-testid={`seller-type-${option.key}`}
                onClick={() => onSelect(option.key)}
                className={`w-full rounded-[26px] border p-4 text-left transition-all duration-200 hover:-translate-y-0.5 ${isSelected ? option.selectedCard : option.card}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${option.accent}`} />
                      <span className="text-base font-semibold">{option.title}</span>
                    </div>
                    <p className={`mt-2 ${isSelected ? option.selectedText : (option.text || sellerHelperTextClass)}`}>{option.subtitle}</p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${isSelected ? option.selectedBadge : option.badge}`}
                  >
                    Выбрать
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SellerSurface>

      <button
        type="button"
        data-testid="seller-type-back"
        onClick={onBack}
        className={sellerButtonClass({ variant: 'secondary', size: 'lg' })}
      >
        Назад
      </button>
    </div>
  );
};

export default SelectBoatType;
