
---

# 📄 `TIME_RULES.md`

```md
# TIME RULES

## Time source
- Используется ТОЛЬКО серверное время
- Никаких client-time
- Никаких timezone guessing

---

## Cutoff logic

seller_cutoff_minutes:
- NULL → НЕТ cutoff
- number → закрытие за N минут до старта

dispatcher_cutoff_minutes:
- всегда >= seller
- может быть NULL

---

## Формула

trip_datetime = datetime(trip_date + trip_time)

seller_cutoff_time =
  trip_datetime - seller_cutoff_minutes

dispatcher_cutoff_time =
  trip_datetime - dispatcher_cutoff_minutes

---

## Проверка

Если now >= seller_cutoff_time
→ SELLER НЕ может продавать

Если now >= dispatcher_cutoff_time
→ DISPATCHER НЕ может продавать
